import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { postDeploy } from "postdeploy";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const chainId = await hre.getChainId();
  const chainName = hre.network.name;

  // Deploy DatasetRegistry first
  const datasetRegistryName = "DatasetRegistry";
  const deployedDatasetRegistry = await deploy(datasetRegistryName, {
    from: deployer,
    log: true,
  });

  console.log(`${datasetRegistryName} contract address: ${deployedDatasetRegistry.address}`);
  console.log(`${datasetRegistryName} chainId: ${chainId}`);
  console.log(`${datasetRegistryName} chainName: ${chainName}`);

  // Deploy JobManager with DatasetRegistry address
  const jobManagerName = "JobManager";
  const deployedJobManager = await deploy(jobManagerName, {
    from: deployer,
    args: [deployedDatasetRegistry.address],
    log: true,
  });

  console.log(`${jobManagerName} contract address: ${deployedJobManager.address}`);
  console.log(`${jobManagerName} chainId: ${chainId}`);
  console.log(`${jobManagerName} chainName: ${chainName}`);

  // Set the JobManager address on the DatasetRegistry
  const DatasetRegistry = await hre.ethers.getContractAt(datasetRegistryName, deployedDatasetRegistry.address);
  const tx = await DatasetRegistry.setJobManager(deployedJobManager.address);
  await tx.wait();
  console.log(`Set JobManager address on DatasetRegistry`);

  // Generate ABI files for both contracts
  postDeploy(chainName, datasetRegistryName);
  postDeploy(chainName, jobManagerName);
};

export default func;

func.id = "deploy_datasetRegistry_and_jobManager";
func.tags = ["DatasetRegistry", "JobManager"];
