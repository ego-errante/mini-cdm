// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RowDecoder} from "./RowDecoder.sol";
import {FHE, euint64, euint8, externalEuint8} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract RowDecoderTestHelper is SepoliaConfig {
    function decodeRowTo64(bytes calldata rowPacked) external returns (euint64[] memory fields) {
        return RowDecoder.decodeRowTo64(rowPacked);
    }

    function decodeRowTo64WithBuyer(
        bytes calldata rowPacked,
        address buyer
    ) external returns (euint64[] memory fields) {
        return RowDecoder.decodeRowTo64WithBuyer(rowPacked, buyer);
    }

    function validateRowStructure(bytes calldata rowPacked) external pure returns (uint256 fieldCount) {
        return RowDecoder.validateRowStructure(rowPacked);
    }

    function getFieldCount(bytes calldata rowPacked) external pure returns (uint256) {
        return RowDecoder.getFieldCount(rowPacked);
    }
}
