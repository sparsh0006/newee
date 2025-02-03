// src/index.ts
import { Plugin } from "@elizaos/core";
import createTrendingToken from "./actions/createTrendingToken";

export const solanaAgentkitPlugin: Plugin = {
    name: "solana",
    description: "Solana Plugin with solana agent kit for Eliza",
    actions: [createTrendingToken],
    evaluators: [],
    providers: [],
};

export default solanaAgentkitPlugin;
