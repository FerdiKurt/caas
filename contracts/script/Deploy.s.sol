// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/CaasWrapper.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();
        new CaasWrapper();
        vm.stopBroadcast();
    }
}
