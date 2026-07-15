// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IERC20.sol";

contract ICO {
    IERC20 public token;
    address public owner;

    uint256 public pricePerToken;
    uint256 public startDate;
    uint256 public endDate;

    event TokensBought(address buyer, uint256 amountPaid, uint256 tokensSent);

    constructor(
        address _token,
        uint256 _pricePerToken,
        uint256 _startDate,
        uint256 _endDate
    ) {
        require(_startDate < _endDate, "start date must be before end date");

        token = IERC20(_token);
        owner = msg.sender;
        pricePerToken = _pricePerToken;
        startDate = _startDate;
        endDate = _endDate;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function isOpen() public view returns (bool) {
        return block.timestamp >= startDate && block.timestamp <= endDate;
    }

    function buyTokens() external payable {
        require(isOpen(), "ICO is not open");
        require(msg.value > 0, "send some ETH");

        uint256 tokensToSend = (msg.value * 1e18) / pricePerToken;
        require(tokensToSend > 0, "not enough ETH sent");
        require(token.balanceOf(address(this)) >= tokensToSend, "not enough tokens left");

        bool sent = token.transfer(msg.sender, tokensToSend);
        require(sent, "token transfer failed");

        emit TokensBought(msg.sender, msg.value, tokensToSend);
    }

    function withdraw() external onlyOwner {
        require(block.timestamp > endDate, "ICO still running");
        (bool sent, ) = owner.call{value: address(this).balance}("");
        require(sent, "withdraw failed");
    }

    function withdrawUnsoldTokens(uint256 amount) external onlyOwner {
        require(block.timestamp > endDate, "ICO still running");
        token.transfer(owner, amount);
    }
}
