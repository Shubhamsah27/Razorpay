import { fixedRetryPolicy } from "../policies/fixedPolicy";
import { noActionPolicy } from "../policies/noAction";
import { generatePopulation } from "../sim/world";
import { FIXED_CASE_COUNT, FIXED_MASTER_SEED } from "./config";
import { summariseArm } from "./metrics";
import { renderReport } from "./report";
import { runArm } from "./simulate";

const masterSeed = process.env.RECOUP_SEED ?? FIXED_MASTER_SEED;
const caseCount = Number(process.env.RECOUP_CASES ?? FIXED_CASE_COUNT);

const population = generatePopulation({ masterSeed, caseCount });
const policies = [noActionPolicy, fixedRetryPolicy];

const arms = policies.map((policy) =>
  summariseArm(runArm(masterSeed, population, policy), population),
);

console.log(
  renderReport({ masterSeed, caseCount, arms, baselineArmName: fixedRetryPolicy.name }),
);
