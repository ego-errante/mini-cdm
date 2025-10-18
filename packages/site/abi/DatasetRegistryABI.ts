
/*
  This file is auto-generated.
  By commands: 'npx hardhat deploy' or 'npx hardhat node'
*/
export const DatasetRegistryABI = {
  "abi": [
    {
      "inputs": [],
      "stateMutability": "nonpayable",
      "type": "constructor"
    },
    {
      "inputs": [],
      "name": "DatasetAlreadyExists",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "DatasetNotFound",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidJobManagerAddress",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidMerkleRoot",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidNumColumns",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidRowCount",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidRowSchema",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "JobManagerNotSet",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "NotDatasetOwner",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "owner",
          "type": "address"
        }
      ],
      "name": "OwnableInvalidOwner",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "account",
          "type": "address"
        }
      ],
      "name": "OwnableUnauthorizedAccount",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "RowCountExceedsUint64Max",
      "type": "error"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "datasetId",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "bytes32",
          "name": "merkleRoot",
          "type": "bytes32"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "numColumns",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "rowCount",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "owner",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "euint32",
          "name": "kAnonymity",
          "type": "bytes32"
        },
        {
          "indexed": false,
          "internalType": "uint32",
          "name": "cooldownSec",
          "type": "uint32"
        }
      ],
      "name": "DatasetCommitted",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "datasetId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "owner",
          "type": "address"
        }
      ],
      "name": "DatasetDeleted",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "jobManager",
          "type": "address"
        }
      ],
      "name": "JobManagerSet",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "address",
          "name": "previousOwner",
          "type": "address"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "newOwner",
          "type": "address"
        }
      ],
      "name": "OwnershipTransferred",
      "type": "event"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "datasetId",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "rowCount",
          "type": "uint256"
        },
        {
          "internalType": "bytes32",
          "name": "merkleRoot",
          "type": "bytes32"
        },
        {
          "internalType": "uint256",
          "name": "numColumns",
          "type": "uint256"
        },
        {
          "internalType": "externalEuint32",
          "name": "kAnonymity",
          "type": "bytes32"
        },
        {
          "internalType": "bytes",
          "name": "inputProof",
          "type": "bytes"
        },
        {
          "internalType": "uint32",
          "name": "cooldownSec",
          "type": "uint32"
        }
      ],
      "name": "commitDataset",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "datasetId",
          "type": "uint256"
        }
      ],
      "name": "deleteDataset",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "datasetId",
          "type": "uint256"
        }
      ],
      "name": "doesDatasetExist",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "datasetId",
          "type": "uint256"
        }
      ],
      "name": "getDataset",
      "outputs": [
        {
          "internalType": "bytes32",
          "name": "merkleRoot",
          "type": "bytes32"
        },
        {
          "internalType": "uint256",
          "name": "numColumns",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "rowCount",
          "type": "uint256"
        },
        {
          "internalType": "address",
          "name": "owner",
          "type": "address"
        },
        {
          "internalType": "bool",
          "name": "exists",
          "type": "bool"
        },
        {
          "internalType": "euint32",
          "name": "kAnonymity",
          "type": "bytes32"
        },
        {
          "internalType": "uint32",
          "name": "cooldownSec",
          "type": "uint32"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "getJobManager",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "datasetId",
          "type": "uint256"
        },
        {
          "internalType": "address",
          "name": "account",
          "type": "address"
        }
      ],
      "name": "isDatasetOwner",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "datasetId",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "fieldCount",
          "type": "uint256"
        }
      ],
      "name": "isRowSchemaValid",
      "outputs": [
        {
          "internalType": "bool",
          "name": "",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "owner",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "protocolId",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "pure",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "renounceOwnership",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "jobManager",
          "type": "address"
        }
      ],
      "name": "setJobManager",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "newOwner",
          "type": "address"
        }
      ],
      "name": "transferOwnership",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
  ]
} as const;

