// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Pure helpers for a discrete-tier progressive pricing curve.
/// @dev Tiers are two parallel arrays: `thresholds[i]` is the cumulative number of
///      tokens sold (18 decimals) at which tier `i` is exhausted, and `prices[i]` is
///      the wei cost of one whole token while that tier is active. Both arrays must
///      be strictly ascending. `thresholds[thresholds.length - 1]` doubles as the
///      hard cap in tokens.
library TieredPricing {
    uint256 private constant TOKEN_UNIT = 1e18;

    error InvalidTierConfig();

    /// @notice Reverts unless `thresholds`/`prices` form a valid, strictly ascending tier curve.
    function validate(uint256[] memory thresholds, uint256[] memory prices) internal pure {
        uint256 len = thresholds.length;
        if (len == 0 || len != prices.length) revert InvalidTierConfig();

        for (uint256 i = 0; i < len; i++) {
            if (prices[i] == 0) revert InvalidTierConfig();
            if (i == 0) {
                if (thresholds[i] == 0) revert InvalidTierConfig();
            } else {
                if (thresholds[i] <= thresholds[i - 1]) revert InvalidTierConfig();
                if (prices[i] <= prices[i - 1]) revert InvalidTierConfig();
            }
        }
    }

    /// @notice Finds the tier that `totalSold` currently sits in.
    /// @return index Index of the active tier (meaningless if `hardCapReached` is true).
    /// @return hardCapReached True once `totalSold` has reached the final threshold.
    function currentTierIndex(
        uint256[] memory thresholds,
        uint256 totalSold
    ) internal pure returns (uint256 index, bool hardCapReached) {
        uint256 len = thresholds.length;
        for (uint256 i = 0; i < len; i++) {
            if (totalSold < thresholds[i]) {
                return (i, false);
            }
        }
        return (len - 1, true);
    }

    /// @notice Quotes a purchase of `weiIn` starting at `totalSold` tokens already sold.
    /// @dev Never sells past the current tier's remaining quantity — a purchase that
    ///      would cross a tier boundary partial-fills at the current tier's price and
    ///      leaves the rest of the payment as change for the caller to refund.
    /// @return tokensToSell Tokens the buyer receives (0 if nothing could be sold).
    /// @return costWei Exact wei cost of `tokensToSell` (always <= weiIn).
    /// @return hardCapReached True if `totalSold` had already reached the hard cap.
    function quote(
        uint256[] memory thresholds,
        uint256[] memory prices,
        uint256 totalSold,
        uint256 weiIn
    ) internal pure returns (uint256 tokensToSell, uint256 costWei, bool hardCapReached) {
        (uint256 idx, bool capReached) = currentTierIndex(thresholds, totalSold);
        if (capReached) {
            return (0, 0, true);
        }

        uint256 remainingInTier = thresholds[idx] - totalSold;
        uint256 price = prices[idx];
        uint256 tokensWanted = (weiIn * TOKEN_UNIT) / price;

        tokensToSell = tokensWanted < remainingInTier ? tokensWanted : remainingInTier;
        costWei = (tokensToSell * price) / TOKEN_UNIT;
        hardCapReached = false;
    }
}
