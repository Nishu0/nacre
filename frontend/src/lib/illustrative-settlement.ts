import { encodeDeployData, keccak256, parseAbi, toHex, type Hex } from "viem";
import artifact from "./illustrative-settlement-artifact.json";
import scenario from "./illustrative-scenario.json";
export const REPLAY_UNDERWRITER = "0xeC5660E8912DC26FC0e5eC700bf05b9f326D6288" as const;
export const REPLAY_INVESTOR = "0x5D94EbA53Fa695FA927DE595778109D297d90870" as const;
export const REPLAY_TOKEN = "0xfa35D165b03B8eB193934D338Db8de536e84AAC8" as const;
export const SCENARIO_HASH = keccak256(toHex(JSON.stringify(scenario)));
export const replayAbi = parseAbi([
  "constructor(address token_,address investor_,bytes32 scenarioHash_)",
  "function stage() view returns (uint8)",
  "function underwriter() view returns (address)", "function investor() view returns (address)",
  "function premium() view returns (uint256)", "function payout() view returns (uint256)",
  "function purchaseBlock() view returns (uint256)", "function settlementBlock() view returns (uint256)",
  "function fund()", "function purchase()", "function settle()", "function cancel()",
  "event DemoPremiumPaid(address indexed investor,address indexed underwriter,uint256 amount)",
  "event IllustrativeSettlement(bytes32 indexed scenarioHash,uint256 simulatedFees,uint256 actualPayout,uint256 collateralReturned)",
]);
export const replayDeployment = () => encodeDeployData({ abi: replayAbi, bytecode: artifact.bytecode as Hex,
  args: [REPLAY_TOKEN, REPLAY_INVESTOR, SCENARIO_HASH] });
export const replayBytecode = artifact.bytecode as Hex;
