// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IICOForAttack {
    function buyTokensPublic() external payable;
    function claimRefund() external;
}

/// @notice Test-only contract that tries to re-enter the ICO from its `receive()` hook,
///         used to prove `nonReentrant` guards actually hold.
contract ReentrancyAttacker {
    IICOForAttack public immutable ico;

    enum Mode {
        None,
        Buy,
        Refund
    }

    Mode public mode;

    constructor(address ico_) {
        ico = IICOForAttack(ico_);
    }

    function attackBuy() external payable {
        mode = Mode.Buy;
        ico.buyTokensPublic{value: msg.value}();
    }

    function attackRefund() external {
        mode = Mode.Refund;
        ico.claimRefund();
    }

    receive() external payable {
        if (mode == Mode.Buy) {
            mode = Mode.None;
            ico.buyTokensPublic{value: msg.value}();
        } else if (mode == Mode.Refund) {
            mode = Mode.None;
            ico.claimRefund();
        }
    }
}
