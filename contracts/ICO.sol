// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {TieredPricing} from "./libraries/TieredPricing.sol";

/// @title ICO
/// @notice A progressive-pricing token sale with a Merkle-gated presale, a hard cap on
///         tokens sold, a soft cap on ETH raised (with pull-based refunds if missed),
///         and post-sale token vesting for buyers.
/// @dev Scope decisions, documented so they read as intentional rather than missing:
///      - Vesting lives in this contract rather than a separate vault. For a single
///        training sale, one contract you can read top-to-bottom beats two contracts
///        with a trust relationship between them. A protocol selling multiple rounds
///        would likely want a shared, separately-deployed vesting vault instead.
///      - Pricing is single-tier-per-purchase, not a bonding curve or blended-tier fill.
///        A purchase fills at the *current* tier's price up to that tier's remaining
///        quantity; leftover ETH beyond that is refunded in the same transaction, and
///        the buyer's next purchase (if any) lands in the next tier. This bounds a
///        front-running attacker's edge to the fixed inter-tier discount instead of the
///        unbounded edge a continuous bonding curve would expose. It does not eliminate
///        that edge entirely — a production system might add commit-reveal purchases,
///        batch auctions, or a per-address per-tier cap on top of this.
///      - Presale (whitelist) and public buyers draw from the *same* tier curve and hard
///        cap. Whitelisting only controls *when* an address may start buying, not a
///        separate discounted allocation pool — avoiding a second cap-accounting
///        dimension for no real teaching benefit.
///      - `finalize()` is permissionless once the sale ends, so an owner can never grief
///        refunds by refusing to call it.
///      - The vesting clock is anchored to the immutable `endDate`, not to whenever
///        `finalize()` happens to be called, so the schedule is fully deterministic at
///        deploy time. The tradeoff: if `finalize()` is called well after `endDate`,
///        buyers may find a chunk of their vesting has already elapsed the moment
///        claiming opens.
///      - `Pausable` gates purchases and token claims only. It deliberately does NOT
///        gate refunds or owner withdrawals — pause exists to stop new exposure, never
///        to trap funds already owed back to someone.
///      - No `receive()`/`fallback()` is defined. A plain ETH transfer must revert, not
///        silently count as a purchase that bypasses tier/whitelist/cap logic.
contract ICO is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    enum Phase {
        Pending,
        Presale,
        Public,
        Ended,
        Finalized
    }

    struct Purchase {
        uint128 ethContributed;
        uint128 tokensAllocated;
        uint128 tokensClaimed;
        bool refunded;
    }

    /// @notice Token being sold. Must already hold enough balance to cover the hard cap.
    IERC20 public immutable token;

    /// @notice Cumulative-tokens-sold thresholds for each pricing tier (strictly ascending).
    uint256[] public tierThresholds;
    /// @notice Wei-per-whole-token price for each pricing tier (strictly ascending).
    uint256[] public tierPrices;

    /// @notice Minimum wei that must be raised for the sale to count as successful.
    uint256 public immutable softCapWei;

    /// @notice Presale (whitelist) purchases open at this timestamp.
    uint256 public immutable startDate;
    /// @notice Presale closes / public sale opens at this timestamp.
    uint256 public immutable publicSaleStart;
    /// @notice Public sale closes at this timestamp.
    uint256 public immutable endDate;

    /// @notice Seconds after `endDate` before any vesting unlocks.
    uint256 public immutable cliffDuration;
    /// @notice Seconds of linear unlock after the cliff ends.
    uint256 public immutable vestingDuration;

    /// @notice Root of the Merkle tree of presale-whitelisted addresses.
    bytes32 public merkleRoot;

    /// @notice Total tokens sold across presale + public purchases so far.
    uint256 public totalTokensSold;
    /// @notice Total wei raised across presale + public purchases so far.
    uint256 public totalWeiRaised;
    /// @notice Total tokens claimed by buyers so far (only relevant once the sale succeeds).
    uint256 public totalTokensClaimed;

    /// @notice True once `finalize()` has been called.
    bool public finalized;
    /// @notice Set by `finalize()`: true if `totalWeiRaised >= softCapWei`.
    bool public softCapReached;

    mapping(address account => Purchase) public purchases;

    event TokensPurchased(address indexed buyer, uint256 weiPaid, uint256 tokensSold);
    event Finalized(bool softCapReached, uint256 totalWeiRaised);
    event RefundClaimed(address indexed buyer, uint256 amount);
    event TokensClaimed(address indexed buyer, uint256 amount);
    event MerkleRootUpdated(bytes32 oldRoot, bytes32 newRoot);
    event Withdrawn(uint256 amount);
    event UnsoldTokensWithdrawn(uint256 amount);

    error ZeroAddress();
    error InvalidDates();
    error NotWhitelisted();
    error WrongPhase();
    error ZeroPayment();
    error HardCapReached();
    error NothingToSell();
    error ChangeTransferFailed();
    error SaleStillRunning();
    error AlreadyFinalized();
    error NotFinalized();
    error SoftCapMet();
    error SoftCapNotMet();
    error NothingToRefund();
    error AlreadyRefunded();
    error RefundTransferFailed();
    error NothingToClaim();
    error NoFundsToWithdraw();
    error WithdrawTransferFailed();

    /// @param token_ ERC20 token being sold.
    /// @param tierThresholds_ Strictly ascending cumulative-tokens-sold tier boundaries; the last entry is the hard cap.
    /// @param tierPrices_ Strictly ascending wei-per-token price for each tier.
    /// @param softCapWei_ Minimum wei raised for the sale to be considered successful.
    /// @param startDate_ Presale opens.
    /// @param publicSaleStart_ Presale closes / public sale opens.
    /// @param endDate_ Public sale closes.
    /// @param merkleRoot_ Initial presale allowlist root (`bytes32(0)` allows nobody).
    /// @param cliffDuration_ Seconds after `endDate_` before vesting starts unlocking.
    /// @param vestingDuration_ Seconds of linear unlock after the cliff.
    constructor(
        IERC20 token_,
        uint256[] memory tierThresholds_,
        uint256[] memory tierPrices_,
        uint256 softCapWei_,
        uint256 startDate_,
        uint256 publicSaleStart_,
        uint256 endDate_,
        bytes32 merkleRoot_,
        uint256 cliffDuration_,
        uint256 vestingDuration_
    ) Ownable(msg.sender) {
        if (address(token_) == address(0)) revert ZeroAddress();
        if (!(startDate_ < publicSaleStart_ && publicSaleStart_ < endDate_)) revert InvalidDates();
        TieredPricing.validate(tierThresholds_, tierPrices_);

        token = token_;
        tierThresholds = tierThresholds_;
        tierPrices = tierPrices_;
        softCapWei = softCapWei_;
        startDate = startDate_;
        publicSaleStart = publicSaleStart_;
        endDate = endDate_;
        cliffDuration = cliffDuration_;
        vestingDuration = vestingDuration_;

        merkleRoot = merkleRoot_;
        emit MerkleRootUpdated(bytes32(0), merkleRoot_);
    }

    /// @notice Current phase, derived purely from timestamps and finalize state.
    function phase() public view returns (Phase) {
        if (finalized) return Phase.Finalized;
        if (block.timestamp < startDate) return Phase.Pending;
        if (block.timestamp < publicSaleStart) return Phase.Presale;
        if (block.timestamp <= endDate) return Phase.Public;
        return Phase.Ended;
    }

    /// @notice Hard cap on tokens sold — the final tier threshold.
    function hardCapTokens() public view returns (uint256) {
        return tierThresholds[tierThresholds.length - 1];
    }

    /// @notice Full tier threshold curve, for off-chain/UI convenience.
    function getTierThresholds() external view returns (uint256[] memory) {
        return tierThresholds;
    }

    /// @notice Full tier price curve, for off-chain/UI convenience.
    function getTierPrices() external view returns (uint256[] memory) {
        return tierPrices;
    }

    /// @notice Buys tokens during the presale, gated by Merkle-proof whitelisting.
    /// @param proof Merkle proof that `msg.sender` is in the tree rooted at `merkleRoot`.
    function buyTokensPresale(bytes32[] calldata proof) external payable whenNotPaused nonReentrant {
        if (phase() != Phase.Presale) revert WrongPhase();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) revert NotWhitelisted();
        _purchase(msg.sender, msg.value);
    }

    /// @notice Buys tokens during the public sale phase.
    function buyTokensPublic() external payable whenNotPaused nonReentrant {
        if (phase() != Phase.Public) revert WrongPhase();
        _purchase(msg.sender, msg.value);
    }

    /// @dev Checks -> effects -> interactions: state is fully updated before any ETH moves.
    function _purchase(address buyer, uint256 weiIn) internal {
        if (weiIn == 0) revert ZeroPayment();

        (uint256 tokensToSell, uint256 costWei, bool hardCapReached_) =
            TieredPricing.quote(tierThresholds, tierPrices, totalTokensSold, weiIn);
        if (hardCapReached_) revert HardCapReached();
        if (tokensToSell == 0) revert NothingToSell();

        uint256 changeWei = weiIn - costWei;

        totalTokensSold += tokensToSell;
        totalWeiRaised += costWei;

        Purchase storage p = purchases[buyer];
        p.ethContributed += costWei.toUint128();
        p.tokensAllocated += tokensToSell.toUint128();

        emit TokensPurchased(buyer, costWei, tokensToSell);

        if (changeWei > 0) {
            (bool sent, ) = buyer.call{value: changeWei}("");
            if (!sent) revert ChangeTransferFailed();
        }
    }

    /// @notice Locks in the sale outcome. Callable by anyone once the sale has ended, so
    ///         an uncooperative owner can never block refunds by withholding this call.
    function finalize() external {
        if (block.timestamp <= endDate) revert SaleStillRunning();
        if (finalized) revert AlreadyFinalized();

        finalized = true;
        softCapReached = totalWeiRaised >= softCapWei;

        emit Finalized(softCapReached, totalWeiRaised);
    }

    /// @notice Claims a full ETH refund of a buyer's contribution if the soft cap was missed.
    function claimRefund() external nonReentrant {
        if (!finalized) revert NotFinalized();
        if (softCapReached) revert SoftCapMet();

        Purchase storage p = purchases[msg.sender];
        uint256 amount = p.ethContributed;
        if (amount == 0) revert NothingToRefund();
        if (p.refunded) revert AlreadyRefunded();

        p.refunded = true;
        emit RefundClaimed(msg.sender, amount);

        (bool sent, ) = msg.sender.call{value: amount}("");
        if (!sent) revert RefundTransferFailed();
    }

    /// @notice Tokens a buyer has vested so far, regardless of how much they've already claimed.
    function vestedAmount(address buyer) public view returns (uint256) {
        uint256 allocated = purchases[buyer].tokensAllocated;
        if (allocated == 0) return 0;

        uint256 cliffEnd = endDate + cliffDuration;
        if (block.timestamp < cliffEnd) return 0;
        if (vestingDuration == 0) return allocated;

        uint256 vestingEnd = cliffEnd + vestingDuration;
        if (block.timestamp >= vestingEnd) return allocated;

        return (allocated * (block.timestamp - cliffEnd)) / vestingDuration;
    }

    /// @notice Tokens a buyer could claim right now.
    function claimableTokens(address buyer) external view returns (uint256) {
        return vestedAmount(buyer) - purchases[buyer].tokensClaimed;
    }

    /// @notice Claims vested tokens. Only ever unlocks if the sale succeeded — a buyer
    ///         whose sale failed the soft cap never received tokens in the first place,
    ///         so there is no clawback to reconcile against their ETH refund.
    function claimVestedTokens() external whenNotPaused nonReentrant {
        if (!finalized) revert NotFinalized();
        if (!softCapReached) revert SoftCapNotMet();

        Purchase storage p = purchases[msg.sender];
        uint256 claimable = vestedAmount(msg.sender) - p.tokensClaimed;
        if (claimable == 0) revert NothingToClaim();

        p.tokensClaimed += claimable.toUint128();
        totalTokensClaimed += claimable;

        emit TokensClaimed(msg.sender, claimable);
        token.safeTransfer(msg.sender, claimable);
    }

    /// @notice Updates the presale whitelist root. Only meaningful before the public
    ///         sale opens, so it's rejected afterward to keep intent unambiguous.
    function updateMerkleRoot(bytes32 newRoot) external onlyOwner {
        if (block.timestamp >= publicSaleStart) revert WrongPhase();
        emit MerkleRootUpdated(merkleRoot, newRoot);
        merkleRoot = newRoot;
    }

    /// @notice Emergency stop for purchases and vesting claims. Refunds and owner
    ///         withdrawals remain callable while paused.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes purchases and vesting claims.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Withdraws the raised ETH. Only available once the sale finalized successfully.
    function withdraw() external onlyOwner nonReentrant {
        if (!finalized) revert NotFinalized();
        if (!softCapReached) revert SoftCapNotMet();

        uint256 amount = address(this).balance;
        if (amount == 0) revert NoFundsToWithdraw();

        emit Withdrawn(amount);

        (bool sent, ) = owner().call{value: amount}("");
        if (!sent) revert WithdrawTransferFailed();
    }

    /// @notice Withdraws tokens not owed to buyers. If the sale succeeded, that's the
    ///         balance minus what's still unclaimed-but-vesting; if it failed, buyers
    ///         never received tokens (they get ETH refunds instead), so the owner may
    ///         reclaim the entire balance.
    function withdrawUnsoldTokens() external onlyOwner nonReentrant {
        if (!finalized) revert NotFinalized();

        uint256 balance = token.balanceOf(address(this));
        uint256 owedToBuyers = softCapReached ? (totalTokensSold - totalTokensClaimed) : 0;
        uint256 amount = balance - owedToBuyers;
        if (amount == 0) revert NoFundsToWithdraw();

        emit UnsoldTokensWithdrawn(amount);
        token.safeTransfer(owner(), amount);
    }
}
