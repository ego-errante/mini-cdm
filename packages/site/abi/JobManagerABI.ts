
/*
  This file is auto-generated.
  By commands: 'npx hardhat deploy' or 'npx hardhat node'
*/
export const JobManagerABI = {
  "abi": [
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "datasetRegistry",
          "type": "address"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "constructor"
    },
    {
      "inputs": [],
      "name": "CannotDivideByZero",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "CooldownActive",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "DatasetNotFound",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "FilterBytecodeTooLong",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "FilterConstsTooLong",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "FilterVMInsufficientBytecode",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "FilterVMInvalidConstantIndex",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "FilterVMInvalidFieldIndex",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "FilterVMInvalidFinalStackState",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "stackName",
          "type": "string"
        }
      ],
      "name": "FilterVMStackNotEmpty",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "stackName",
          "type": "string"
        }
      ],
      "name": "FilterVMStackOverflow",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "stackName",
          "type": "string"
        }
      ],
      "name": "FilterVMStackUnderflow",
      "type": "error"
    },
    {
      "inputs": [
        {
          "internalType": "uint8",
          "name": "opcode",
          "type": "uint8"
        }
      ],
      "name": "FilterVMUnknownOpcode",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "IncompleteProcessing",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InsufficientAllowance",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InsufficientPayment",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidClampRange",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidFieldIndex",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidMerkleProof",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "InvalidRowSchema",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "JobClosed",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "JobNotFinalized",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "KAnonymityNotMet",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "MerkleVerificationFailed",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "NotDatasetOwner",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "NotJobBuyer",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "NotRequestBuyer",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "NotStalled",
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
      "name": "PaymentFailed",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "ReentrancyGuardReentrantCall",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "RequestNotPending",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "RowOutOfOrder",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "WeightsLengthMismatch",
      "type": "error"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "AllowanceToppedUp",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "buyer",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "euint256",
          "name": "result",
          "type": "bytes32"
        },
        {
          "indexed": false,
          "internalType": "ebool",
          "name": "isOverflow",
          "type": "bytes32"
        }
      ],
      "name": "JobFinalized",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "datasetId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "buyer",
          "type": "address"
        }
      ],
      "name": "JobOpened",
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
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        }
      ],
      "name": "RequestAccepted",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        }
      ],
      "name": "RequestCancelled",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        }
      ],
      "name": "RequestCompleted",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        }
      ],
      "name": "RequestRejected",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        }
      ],
      "name": "RequestStalled",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "datasetId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "buyer",
          "type": "address"
        }
      ],
      "name": "RequestSubmitted",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        }
      ],
      "name": "RowPushed",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "seller",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "SellerPaid",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "newThreshold",
          "type": "uint256"
        }
      ],
      "name": "ThresholdUpdated",
      "type": "event"
    },
    {
      "inputs": [],
      "name": "DATASET_REGISTRY",
      "outputs": [
        {
          "internalType": "contract IDatasetRegistry",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "STALL_TIMEOUT",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        }
      ],
      "name": "acceptRequest",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        }
      ],
      "name": "cancelRequest",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        }
      ],
      "name": "finalize",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        }
      ],
      "name": "getJobProgress",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "totalRows",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "processedRows",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "remainingRows",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        }
      ],
      "name": "getJobResult",
      "outputs": [
        {
          "internalType": "bool",
          "name": "isFinalized",
          "type": "bool"
        },
        {
          "internalType": "euint256",
          "name": "result",
          "type": "bytes32"
        },
        {
          "internalType": "ebool",
          "name": "isOverflow",
          "type": "bytes32"
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
      "name": "getPendingRequestsForDataset",
      "outputs": [
        {
          "internalType": "uint256[]",
          "name": "",
          "type": "uint256[]"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        }
      ],
      "name": "getRequest",
      "outputs": [
        {
          "components": [
            {
              "internalType": "uint256",
              "name": "datasetId",
              "type": "uint256"
            },
            {
              "internalType": "address",
              "name": "buyer",
              "type": "address"
            },
            {
              "components": [
                {
                  "internalType": "enum IJobManager.Op",
                  "name": "op",
                  "type": "uint8"
                },
                {
                  "internalType": "uint16",
                  "name": "targetField",
                  "type": "uint16"
                },
                {
                  "internalType": "uint16[]",
                  "name": "weights",
                  "type": "uint16[]"
                },
                {
                  "internalType": "uint32",
                  "name": "divisor",
                  "type": "uint32"
                },
                {
                  "internalType": "uint64",
                  "name": "clampMin",
                  "type": "uint64"
                },
                {
                  "internalType": "uint64",
                  "name": "clampMax",
                  "type": "uint64"
                },
                {
                  "internalType": "uint32",
                  "name": "roundBucket",
                  "type": "uint32"
                },
                {
                  "components": [
                    {
                      "internalType": "bytes",
                      "name": "bytecode",
                      "type": "bytes"
                    },
                    {
                      "internalType": "uint256[]",
                      "name": "consts",
                      "type": "uint256[]"
                    }
                  ],
                  "internalType": "struct IJobManager.FilterProg",
                  "name": "filter",
                  "type": "tuple"
                }
              ],
              "internalType": "struct IJobManager.JobParams",
              "name": "params",
              "type": "tuple"
            },
            {
              "internalType": "enum IJobManager.RequestStatus",
              "name": "status",
              "type": "uint8"
            },
            {
              "internalType": "uint256",
              "name": "timestamp",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "jobId",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "baseFee",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "computeAllowance",
              "type": "uint256"
            },
            {
              "internalType": "uint256",
              "name": "gasDebtToSeller",
              "type": "uint256"
            }
          ],
          "internalType": "struct IJobManager.JobRequest",
          "name": "",
          "type": "tuple"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        }
      ],
      "name": "jobBuyer",
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
          "name": "jobId",
          "type": "uint256"
        }
      ],
      "name": "jobDataset",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        }
      ],
      "name": "jobOpen",
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
      "name": "nextJobId",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "nextRequestId",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
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
          "name": "buyer",
          "type": "address"
        },
        {
          "components": [
            {
              "internalType": "enum IJobManager.Op",
              "name": "op",
              "type": "uint8"
            },
            {
              "internalType": "uint16",
              "name": "targetField",
              "type": "uint16"
            },
            {
              "internalType": "uint16[]",
              "name": "weights",
              "type": "uint16[]"
            },
            {
              "internalType": "uint32",
              "name": "divisor",
              "type": "uint32"
            },
            {
              "internalType": "uint64",
              "name": "clampMin",
              "type": "uint64"
            },
            {
              "internalType": "uint64",
              "name": "clampMax",
              "type": "uint64"
            },
            {
              "internalType": "uint32",
              "name": "roundBucket",
              "type": "uint32"
            },
            {
              "components": [
                {
                  "internalType": "bytes",
                  "name": "bytecode",
                  "type": "bytes"
                },
                {
                  "internalType": "uint256[]",
                  "name": "consts",
                  "type": "uint256[]"
                }
              ],
              "internalType": "struct IJobManager.FilterProg",
              "name": "filter",
              "type": "tuple"
            }
          ],
          "internalType": "struct IJobManager.JobParams",
          "name": "params",
          "type": "tuple"
        }
      ],
      "name": "openJob",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
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
      "name": "paymentThreshold",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
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
      "inputs": [
        {
          "internalType": "uint256",
          "name": "jobId",
          "type": "uint256"
        },
        {
          "internalType": "bytes",
          "name": "rowPacked",
          "type": "bytes"
        },
        {
          "internalType": "bytes32[]",
          "name": "merkleProof",
          "type": "bytes32[]"
        },
        {
          "internalType": "uint256",
          "name": "rowIndex",
          "type": "uint256"
        }
      ],
      "name": "pushRow",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        }
      ],
      "name": "reclaimStalled",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        }
      ],
      "name": "rejectRequest",
      "outputs": [],
      "stateMutability": "nonpayable",
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
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        }
      ],
      "name": "requestPayout",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "newThreshold",
          "type": "uint256"
        }
      ],
      "name": "setPaymentThreshold",
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
        },
        {
          "components": [
            {
              "internalType": "enum IJobManager.Op",
              "name": "op",
              "type": "uint8"
            },
            {
              "internalType": "uint16",
              "name": "targetField",
              "type": "uint16"
            },
            {
              "internalType": "uint16[]",
              "name": "weights",
              "type": "uint16[]"
            },
            {
              "internalType": "uint32",
              "name": "divisor",
              "type": "uint32"
            },
            {
              "internalType": "uint64",
              "name": "clampMin",
              "type": "uint64"
            },
            {
              "internalType": "uint64",
              "name": "clampMax",
              "type": "uint64"
            },
            {
              "internalType": "uint32",
              "name": "roundBucket",
              "type": "uint32"
            },
            {
              "components": [
                {
                  "internalType": "bytes",
                  "name": "bytecode",
                  "type": "bytes"
                },
                {
                  "internalType": "uint256[]",
                  "name": "consts",
                  "type": "uint256[]"
                }
              ],
              "internalType": "struct IJobManager.FilterProg",
              "name": "filter",
              "type": "tuple"
            }
          ],
          "internalType": "struct IJobManager.JobParams",
          "name": "params",
          "type": "tuple"
        },
        {
          "internalType": "uint256",
          "name": "baseFee",
          "type": "uint256"
        }
      ],
      "name": "submitRequest",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        }
      ],
      "stateMutability": "payable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "requestId",
          "type": "uint256"
        }
      ],
      "name": "topUpAllowance",
      "outputs": [],
      "stateMutability": "payable",
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

