// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "hardhat/console.sol";
import {
    FHE,
    euint64,
    euint8,
    euint32,
    externalEuint8,
    externalEuint32,
    externalEuint64
} from "@fhevm/solidity/lib/FHE.sol";


/**
 * @title RowDecoder
 * @notice Library for decoding encrypted row data from datasets
 * @dev Handles parsing of packed row format with FHE encrypted fields
 */
library RowDecoder {
    /**
     * @notice Decodes packed row data into array of euint64 fields
     * @param rowPacked ABI-encoded sequence of (typeTag | external ciphertext | proof) for each field
     * @return fields Array of decrypted euint64 values, upcast from original types
     *
     * Packed row format per field:
     * - typeTag: uint8 (1=euint8, 2=euint32, 3=euint64)
     * - extLen: uint16 (length of external ciphertext in bytes)
     * - extCipher: bytes (ABI-encoded external ciphertext)
     * - proofLen: uint16 (length of proof in bytes)
     * - proof: bytes (ZK proof for decryption)
     */
    function decodeRowTo64(
        bytes calldata rowPacked
    ) internal returns (euint64[] memory fields) {
        uint256 fieldCount = validateRowStructure(rowPacked);
        fields = new euint64[](fieldCount);

        uint256 i = 0;
        for (uint256 f = 0; f < fieldCount; f++) {
            (euint64 field, uint256 newIndex) = _decodeFieldAt(rowPacked, i);
            fields[f] = field;
            i = newIndex;

            FHE.allowThis(fields[f]);
            FHE.allow(fields[f], msg.sender);
        }
    }

    /**
     * @notice Decodes a single field at the given index
     * @param rowPacked The packed row data
     * @param startIndex Starting index for this field
     * @return field The decoded field as euint64
     * @return nextIndex Index where the next field starts
     */
    function _decodeFieldAt(
        bytes calldata rowPacked,
        uint256 startIndex
    ) public returns (euint64 field, uint256 nextIndex) {
        uint8 typeTag = uint8(rowPacked[startIndex]);
        uint256 i = startIndex + 1;

        uint16 extLen = (uint16(uint8(rowPacked[i])) << 8) | uint16(uint8(rowPacked[i + 1]));
        i += 2;
        bytes calldata extCipher = rowPacked[i:i + extLen];
        i += extLen;

        uint16 proofLen = (uint16(uint8(rowPacked[i])) << 8) | uint16(uint8(rowPacked[i + 1]));
        i += 2;
        bytes calldata proof = rowPacked[i:i + proofLen];
        nextIndex = i + proofLen;

        field = _convertToEuint64(typeTag, extCipher, proof);
    }

    /**
     * @notice Converts external ciphertext to euint64 based on type tag
     * @param typeTag Type identifier (1=euint8, 2=euint32, 3=euint64)
     * @param extCipher External ciphertext bytes
     * @param proof ZK proof for decryption
     * @return field The converted euint64 value
     */
    function _convertToEuint64(
        uint8 typeTag,
        bytes calldata extCipher,
        bytes calldata proof
    ) private returns (euint64 field) {
        bytes32 handle = toBytes32(extCipher);

        if (typeTag == 1) {
            externalEuint8 eext = externalEuint8.wrap(handle);
            euint8 evalue = FHE.fromExternal(eext, proof);
            field = FHE.asEuint64(evalue);
        } else if (typeTag == 2) {
            externalEuint32 eext = externalEuint32.wrap(handle);
            euint32 evalue = FHE.fromExternal(eext, proof);
            field = FHE.asEuint64(evalue);
        } else {
            externalEuint64 eext = externalEuint64.wrap(handle);
            field = FHE.fromExternal(eext, proof);
        }
    }

    function toBytes32(bytes calldata _bytes) internal pure returns (bytes32 result) {
        require(_bytes.length == 32, "toBytes32: bytes length must be 32");
        bytes memory temp = _bytes;
        result = abi.decode(temp, (bytes32));
    }

    /**
     * @notice Validates the structure of packed row data without decoding
     * @param rowPacked The packed row data to validate
     * @return fieldCount Number of fields in the row
     */
    function validateRowStructure(bytes calldata rowPacked) internal pure returns (uint256 fieldCount) {
        uint256 tempI = 0;
        fieldCount = 0;

        while (tempI < rowPacked.length) {
            if (tempI + 1 > rowPacked.length) revert("Incomplete type tag");
            uint8 typeTag = uint8(rowPacked[tempI]);
            if (typeTag < 1 || typeTag > 3) revert("Invalid type tag");

            tempI += 1; // skip typeTag

            if (tempI + 2 > rowPacked.length) revert("Incomplete ext length");
            uint16 extLen = (uint16(uint8(rowPacked[tempI])) << 8) | uint16(uint8(rowPacked[tempI + 1]));
            tempI += 2 + extLen; // skip extLen + extCipher

            if (tempI + 2 > rowPacked.length) revert("Incomplete proof length");
            uint16 proofLen = (uint16(uint8(rowPacked[tempI])) << 8) | uint16(uint8(rowPacked[tempI + 1]));
            tempI += 2 + proofLen; // skip proofLen + proof

            fieldCount++;
        }

        if (tempI != rowPacked.length) revert("Extra data in row");
    }

    /**
     * @notice Gets the field count from packed row data
     * @param rowPacked The packed row data
     * @return Number of fields in the row
     */
    function getFieldCount(bytes calldata rowPacked) internal pure returns (uint256) {
        uint256 tempI = 0;
        uint256 fieldCount = 0;

        while (tempI < rowPacked.length) {
            if (tempI + 1 > rowPacked.length) revert("Incomplete type tag");
            uint8 typeTag = uint8(rowPacked[tempI]);
            if (typeTag < 1 || typeTag > 3) revert("Invalid type tag");

            tempI += 1; // skip typeTag

            if (tempI + 2 > rowPacked.length) revert("Incomplete ext length");
            uint16 extLen = (uint16(uint8(rowPacked[tempI])) << 8) | uint16(uint8(rowPacked[tempI + 1]));
            tempI += 2 + extLen; // skip extLen + extCipher

            if (tempI + 2 > rowPacked.length) revert("Incomplete proof length");
            uint16 proofLen = (uint16(uint8(rowPacked[tempI])) << 8) | uint16(uint8(rowPacked[tempI + 1]));
            tempI += 2 + proofLen; // skip proofLen + proof

            fieldCount++;
        }

        if (tempI != rowPacked.length) revert("Extra data in row");

        return fieldCount;
    }
}
