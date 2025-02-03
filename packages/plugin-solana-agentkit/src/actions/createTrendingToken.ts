import {
    ActionExample,
    composeContext,
    Content,
    elizaLogger,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    type Action,
    generateText,
    ServiceType,
} from "@elizaos/core";
import { SolanaAgentKit } from "solana-agent-kit";
import { HandlerCallback, TwitterClient } from "../types/eliza";

interface TrendingTokenContent extends Content {
    trend: string;
    name: string;
    symbol: string;
    description: string;
    uri: string;
    decimals: number;
}

function isTrendingTokenContent(content: any): content is TrendingTokenContent {
    return (
        typeof content.trend === "string" &&
        typeof content.name === "string" &&
        typeof content.symbol === "string" &&
        typeof content.description === "string" &&
        typeof content.uri === "string" &&
        typeof content.decimals === "number"
    );
}

const trendingTokenTemplate = `Generate a token based on the trending topic. Response must be JSON:

\`json
{
    "trend": "trending topic",
    "name": "Token name (max 32 chars)",
    "symbol": "3-5 letter uppercase ticker",
    "description": "Token purpose and relation to trend",
    "uri": "https://raw.githubusercontent.com/solana-developers/opos-asset/main/assets/CompressedCoil/image.png",
    "decimals": 9
}
\`

Current trending topic: {{trend}}`;

export default {
    name: "CREATE_TRENDING_TOKEN" as const,
    similes: ["LAUNCH_TRENDING_TOKEN"],
    validate: async (_runtime: IAgentRuntime, _message: Memory) => true,
    description: "Create tokens based on trending topics",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Starting CREATE_TRENDING_TOKEN handler...");

        try {
            // Get trending topic
            const twitterClient = runtime.getService<TwitterClient>(
                "TWITTER_CLIENT" as ServiceType
            );
            const trends = await twitterClient.getTrends();
            const topTrend = trends[0]?.name;

            if (!topTrend) {
                throw new Error("No trending topics found");
            }

            // Check if trend was used
            const usedTrends =
                (await runtime.cacheManager.get<string[]>(
                    "twitter/used_trends"
                )) || [];
            if (usedTrends.includes(topTrend)) {
                throw new Error("Top trend already used");
            }

            // Generate token info
            const tokenContext = composeContext({
                state: { ...state, trend: topTrend },
                template: trendingTokenTemplate,
            });

            const content = await generateText({
                runtime,
                context: tokenContext,
                modelClass: ModelClass.LARGE,
            });

            const tokenInfo = JSON.parse(content);
            if (!isTrendingTokenContent(tokenInfo)) {
                throw new Error("Invalid token content generated");
            }

            // Deploy token
            const solanaAgentKit = new SolanaAgentKit(
                runtime.getSetting("SOLANA_PRIVATE_KEY"),
                runtime.getSetting("SOLANA_RPC_URL"),
                runtime.getSetting("OPENAI_API_KEY")
            );

            const deployedToken = await solanaAgentKit.deployToken(
                tokenInfo.name,
                tokenInfo.uri,
                tokenInfo.symbol,
                tokenInfo.decimals
            );

            // Cache used trend
            usedTrends.push(topTrend);
            await runtime.cacheManager.set("twitter/used_trends", usedTrends);

            // Store token info
            const launchedTokens =
                (await runtime.cacheManager.get<any[]>(
                    "twitter/launched_tokens"
                )) || [];
            launchedTokens.push({
                ...tokenInfo,
                mintAddress: deployedToken.mint.toString(),
                timestamp: Date.now(),
            });
            await runtime.cacheManager.set(
                "twitter/launched_tokens",
                launchedTokens
            );

            if (callback) {
                callback({
                    text: `Successfully created trending token ${tokenInfo.name} ($${tokenInfo.symbol}) based on trend: ${topTrend}`,
                    content: {
                        success: true,
                        deployedAddress: deployedToken.mint.toString(),
                        tokenInfo,
                    },
                });
            }
            return true;
        } catch (error) {
            elizaLogger.error("Error in CREATE_TRENDING_TOKEN:", error);
            if (callback) {
                callback({
                    text: `Error creating trending token: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Create a token based on current trending topic",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Generating trending token...",
                    action: "CREATE_TRENDING_TOKEN",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Successfully created trending token TrendToken (TRND)",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;
