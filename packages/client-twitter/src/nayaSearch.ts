import { SearchMode } from "agent-twitter-client";
import { composeContext, elizaLogger } from "@elizaos/core";
import { generateMessageResponse, generateText } from "@elizaos/core";
import { messageCompletionFooter } from "@elizaos/core";
import {
    Content,
    HandlerCallback,
    IAgentRuntime,
    IImageDescriptionService,
    ModelClass,
    ServiceType,
    State,
} from "@elizaos/core";
import { stringToUuid } from "@elizaos/core";
import { ClientBase } from "./base";
import { buildConversationThread, sendTweet, wait } from "./utils.ts";

interface TokenInfo {
    name: string;
    ticker: string;
    description: string;
    imagePrompt: string;
    sourceTrend: string;
}

interface TwitterTrend {
    name: string;
    url: string;
    promoted_content: boolean;
    query: string;
    tweet_volume: number | null;
}

const twitterSearchTemplate =
    `{{timeline}}

{{providers}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{postDirections}}

{{recentPosts}}

# Task: Respond to the following post in the style and perspective of {{agentName}} (aka @{{twitterUserName}}). Write a {{adjective}} response for {{agentName}} to say directly in response to the post. don't generalize.
{{currentPost}}

IMPORTANT: Your response CANNOT be longer than 20 words.
Aim for 1-2 short sentences maximum. Be concise and direct.

Your response should not contain any questions. Brief, concise statements only. No emojis. Use \\n\\n (double spaces) between statements.

` + messageCompletionFooter;

export class TwitterSearchClient {
    client: ClientBase;
    runtime: IAgentRuntime;
    twitterUsername: string;
    private respondedTweets: Set<string> = new Set();

    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
        this.twitterUsername = this.client.twitterConfig.TWITTER_USERNAME;
    }

    async start() {
        // Get trends and generate token
        const tokenInfo = await this.getTopTrendAndGenerateToken();
        if (tokenInfo) {
            elizaLogger.log("Generated token info:", tokenInfo);
            // Store the generated token info
            await this.storeTokenInfo(tokenInfo);
        }

        // Continue with existing functionality
        this.engageWithSearchTermsLoop();
    }

    async getTopTrendAndGenerateToken(): Promise<TokenInfo | null> {
        try {
            // Get trends
            const trends =
                (await this.client.twitterClient.getTrends()) as unknown as TwitterTrend[];
            elizaLogger.log("Fetched trends:", trends);

            // Get first valid unused trend
            let selectedTrend = null;
            for (const trend of trends) {
                const isUsed = await this.isTopicUsed(trend.name);
                if (!isUsed) {
                    selectedTrend = trend.name;
                    break;
                }
            }

            if (!selectedTrend) {
                elizaLogger.log("No unused trends found");
                return null;
            }

            // Generate token info using LLM
            const prompt = `
Given the trending topic "${selectedTrend}", generate a crypto token concept with the following:

1. A creative token name related to this trend (max 32 characters)
2. A unique ticker symbol (3-5 characters)
3. A brief description of the token's purpose (max 100 words)
4. An image prompt that would represent this token (max 50 words)

Format the response as JSON with keys: name, ticker, description, imagePrompt

The name should be catchy and memorable, the ticker should be unique and related,
the description should explain the token's purpose and relation to the trend,
and the image prompt should describe a professional logo or icon.

Ensure the ticker is UPPERCASE and contains only letters.
`;

            const response = await generateText({
                runtime: this.runtime,
                context: prompt,
                modelClass: ModelClass.LARGE,
            });

            let tokenInfo: TokenInfo;
            try {
                tokenInfo = JSON.parse(response);
                tokenInfo.sourceTrend = selectedTrend;

                // Validate token info
                if (!this.validateTokenInfo(tokenInfo)) {
                    elizaLogger.error("Invalid token info generated");
                    return null;
                }

                // Format ticker to be uppercase
                tokenInfo.ticker = tokenInfo.ticker.toUpperCase();
            } catch (error) {
                elizaLogger.error("Error parsing LLM response:", error);
                return null;
            }

            // Cache the used trend
            await this.cacheUsedTrend(selectedTrend);

            return tokenInfo;
        } catch (error) {
            elizaLogger.error("Error generating token info:", error);
            return null;
        }
    }

    private validateTokenInfo(tokenInfo: TokenInfo): boolean {
        return (
            typeof tokenInfo.name === "string" &&
            tokenInfo.name.length <= 32 &&
            typeof tokenInfo.ticker === "string" &&
            tokenInfo.ticker.length >= 3 &&
            tokenInfo.ticker.length <= 5 &&
            /^[A-Za-z]+$/.test(tokenInfo.ticker) &&
            typeof tokenInfo.description === "string" &&
            typeof tokenInfo.imagePrompt === "string"
        );
    }

    private async cacheUsedTrend(trend: string) {
        const usedTrends =
            (await this.runtime.cacheManager.get<string[]>(
                "twitter/used_trends"
            )) || [];
        usedTrends.push(trend);
        await this.runtime.cacheManager.set("twitter/used_trends", usedTrends);
    }

    private async isTopicUsed(trend: string): Promise<boolean> {
        const usedTrends =
            (await this.runtime.cacheManager.get<string[]>(
                "twitter/used_trends"
            )) || [];
        return usedTrends.includes(trend);
    }

    private async storeTokenInfo(tokenInfo: TokenInfo) {
        const generatedTokens =
            (await this.runtime.cacheManager.get<TokenInfo[]>(
                "twitter/generated_tokens"
            )) || [];
        generatedTokens.push(tokenInfo);
        await this.runtime.cacheManager.set(
            "twitter/generated_tokens",
            generatedTokens
        );

        // Optional: Announce the new token on Twitter
        if (this.client.twitterConfig.ANNOUNCE_NEW_TOKENS) {
            const announcement = ` New Token Alert! 🔥\n\n${tokenInfo.name} ($${tokenInfo.ticker})\n\n${tokenInfo.description}\n\n#crypto #newtoken `;

            try {
                const tweet =
                    await this.client.twitterClient.sendTweet(announcement);
                elizaLogger.log("Token announcement tweeted:", tweet);
            } catch (error) {
                elizaLogger.error("Error announcing new token:", error);
            }
        }
    }

    // Keep all existing methods...
    private engageWithSearchTermsLoop() {
        // Keep existing implementation
        this.engageWithSearchTerms().then();
        const randomMinutes = Math.floor(Math.random() * (120 - 60 + 1)) + 60;
        elizaLogger.log(
            `Next twitter search scheduled in ${randomMinutes} minutes`
        );
        setTimeout(
            () => this.engageWithSearchTermsLoop(),
            randomMinutes * 60 * 1000
        );
    }

    private async engageWithSearchTerms() {
        // Keep existing implementation

        elizaLogger.log("Engaging with search terms");
        try {
            const searchTerm = [...this.runtime.character.topics][
                Math.floor(Math.random() * this.runtime.character.topics.length)
            ];

            elizaLogger.log("Fetching search tweets");
            // TODO: we wait 5 seconds here to avoid getting rate limited on startup, but we should queue
            await new Promise((resolve) => setTimeout(resolve, 5000));
            const recentTweets = await this.client.fetchSearchTweets(
                searchTerm,
                20,
                SearchMode.Top
            );
            elizaLogger.log("Search tweets fetched");

            const homeTimeline = await this.client.fetchHomeTimeline(50);

            await this.client.cacheTimeline(homeTimeline);

            const formattedHomeTimeline =
                `# ${this.runtime.character.name}'s Home Timeline\n\n` +
                homeTimeline
                    .map((tweet) => {
                        return `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}\nText: ${tweet.text}\n---\n`;
                    })
                    .join("\n");

            // randomly slice .tweets down to 20
            const slicedTweets = recentTweets.tweets
                .sort(() => Math.random() - 0.5)
                .slice(0, 20);

            if (slicedTweets.length === 0) {
                elizaLogger.log(
                    "No valid tweets found for the search term",
                    searchTerm
                );
                return;
            }

            const prompt = `
          Here are some tweets related to the search term "${searchTerm}":

          ${[...slicedTweets, ...homeTimeline]
              .filter((tweet) => {
                  // ignore tweets where any of the thread tweets contain a tweet by the bot
                  const thread = tweet.thread;
                  const botTweet = thread.find(
                      (t) => t.username === this.twitterUsername
                  );
                  return !botTweet;
              })
              .map(
                  (tweet) => `
            ID: ${tweet.id}${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}
            From: ${tweet.name} (@${tweet.username})
            Text: ${tweet.text}
          `
              )
              .join("\n")}

          Which tweet is the most interesting and relevant for Ruby to reply to? Please provide only the ID of the tweet in your response.
          Notes:
            - Respond to English tweets only
            - Respond to tweets that don't have a lot of hashtags, links, URLs or images
            - Respond to tweets that are not retweets
            - Respond to tweets where there is an easy exchange of ideas to have with the user
            - ONLY respond with the ID of the tweet`;

            const mostInterestingTweetResponse = await generateText({
                runtime: this.runtime,
                context: prompt,
                modelClass: ModelClass.SMALL,
            });

            const tweetId = mostInterestingTweetResponse.trim();
            const selectedTweet = slicedTweets.find(
                (tweet) =>
                    tweet.id.toString().includes(tweetId) ||
                    tweetId.includes(tweet.id.toString())
            );

            if (!selectedTweet) {
                elizaLogger.warn("No matching tweet found for the selected ID");
                elizaLogger.log("Selected tweet ID:", tweetId);
                return;
            }

            elizaLogger.log("Selected tweet to reply to:", selectedTweet?.text);

            if (selectedTweet.username === this.twitterUsername) {
                elizaLogger.log("Skipping tweet from bot itself");
                return;
            }

            const conversationId = selectedTweet.conversationId;
            const roomId = stringToUuid(
                conversationId + "-" + this.runtime.agentId
            );

            const userIdUUID = stringToUuid(selectedTweet.userId as string);

            await this.runtime.ensureConnection(
                userIdUUID,
                roomId,
                selectedTweet.username,
                selectedTweet.name,
                "twitter"
            );

            // crawl additional conversation tweets, if there are any
            await buildConversationThread(selectedTweet, this.client);

            const message = {
                id: stringToUuid(selectedTweet.id + "-" + this.runtime.agentId),
                agentId: this.runtime.agentId,
                content: {
                    text: selectedTweet.text,
                    url: selectedTweet.permanentUrl,
                    inReplyTo: selectedTweet.inReplyToStatusId
                        ? stringToUuid(
                              selectedTweet.inReplyToStatusId +
                                  "-" +
                                  this.runtime.agentId
                          )
                        : undefined,
                },
                userId: userIdUUID,
                roomId,
                // Timestamps are in seconds, but we need them in milliseconds
                createdAt: selectedTweet.timestamp * 1000,
            };

            if (!message.content.text) {
                elizaLogger.warn("Returning: No response text found");
                return;
            }

            // Fetch replies and retweets
            const replies = selectedTweet.thread;
            const replyContext = replies
                .filter((reply) => reply.username !== this.twitterUsername)
                .map((reply) => `@${reply.username}: ${reply.text}`)
                .join("\n");

            let tweetBackground = "";
            if (selectedTweet.isRetweet) {
                const originalTweet = await this.client.requestQueue.add(() =>
                    this.client.twitterClient.getTweet(selectedTweet.id)
                );
                tweetBackground = `Retweeting @${originalTweet.username}: ${originalTweet.text}`;
            }

            this.client.twitterClient.getTrends();

            // Generate image descriptions using GPT-4 vision API
            const imageDescriptions = [];
            for (const photo of selectedTweet.photos) {
                const description = await this.runtime
                    .getService<IImageDescriptionService>(
                        ServiceType.IMAGE_DESCRIPTION
                    )
                    .describeImage(photo.url);
                imageDescriptions.push(description);
            }

            let state = await this.runtime.composeState(message, {
                twitterClient: this.client.twitterClient,
                twitterUserName: this.twitterUsername,
                timeline: formattedHomeTimeline,
                tweetContext: `${tweetBackground}

          Original Post:
          By @${selectedTweet.username}
          ${selectedTweet.text}${replyContext.length > 0 && `\nReplies to original post:\n${replyContext}`}
          ${`Original post text: ${selectedTweet.text}`}
          ${selectedTweet.urls.length > 0 ? `URLs: ${selectedTweet.urls.join(", ")}\n` : ""}${imageDescriptions.length > 0 ? `\nImages in Post (Described): ${imageDescriptions.join(", ")}\n` : ""}
          `,
            });

            await this.client.saveRequestMessage(message, state as State);

            const context = composeContext({
                state,
                template:
                    this.runtime.character.templates?.twitterSearchTemplate ||
                    twitterSearchTemplate,
            });

            const responseContent = await generateMessageResponse({
                runtime: this.runtime,
                context,
                modelClass: ModelClass.LARGE,
            });

            responseContent.inReplyTo = message.id;

            const response = responseContent;

            if (!response.text) {
                elizaLogger.warn("Returning: No response text found");
                return;
            }

            elizaLogger.log(
                `Bot would respond to tweet ${selectedTweet.id} with: ${response.text}`
            );
            try {
                const callback: HandlerCallback = async (response: Content) => {
                    const memories = await sendTweet(
                        this.client,
                        response,
                        message.roomId,
                        this.twitterUsername,
                        tweetId
                    );
                    return memories;
                };

                const responseMessages = await callback(responseContent);

                state = await this.runtime.updateRecentMessageState(state);

                for (const responseMessage of responseMessages) {
                    await this.runtime.messageManager.createMemory(
                        responseMessage,
                        false
                    );
                }

                state = await this.runtime.updateRecentMessageState(state);

                await this.runtime.evaluate(message, state);

                await this.runtime.processActions(
                    message,
                    responseMessages,
                    state,
                    callback
                );

                this.respondedTweets.add(selectedTweet.id);
                const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${selectedTweet.id} - ${selectedTweet.username}: ${selectedTweet.text}\nAgent's Output:\n${response.text}`;

                await this.runtime.cacheManager.set(
                    `twitter/tweet_generation_${selectedTweet.id}.txt`,
                    responseInfo
                );

                await wait();
            } catch (error) {
                console.error(`Error sending response post: ${error}`);
            }
        } catch (error) {
            console.error("Error engaging with search terms:", error);
        }
    }
}
