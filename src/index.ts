import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import SleeperAPI from "./sleeper";


export class SleeperMCP extends McpAgent {
    server = new McpServer({
        name: "Sleeper API",
        version: "1.0.0",
    });

    private sleeperApi = new SleeperAPI();

    async init() {
        this.server.tool(
            "get_user",
            "Get user information by username or user ID. Ask the user for their username and call this method first before looking up any league details.",
            { username_or_id: z.string() }, 
            async ({ username_or_id }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getUser(username_or_id), null, 2) }],
            })
        );

        this.server.tool(
            "get_user_leagues",
            "Get all leagues for a user in a specific sport and season.",
            { 
                user_id: z.string(),
                sport: z.string().default("nfl"),
                season: z.string().default("2024")
            },
            async ({ user_id, sport, season }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getUserLeagues(user_id, sport, season), null, 2) }],
            })
        );

        this.server.tool(
            "get_league",
            "Get league information and settings.",
            { league_id: z.string() },
            async ({ league_id }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getLeague(league_id), null, 2) }],
            })
        );

        this.server.tool(
            "get_league_rosters",
            "Get all team rosters in a league with optional player enrichment.",
            { 
                league_id: z.string(),
                enrich_players: z.boolean().default(true)
            },
            async ({ league_id, enrich_players }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getLeagueRosters(league_id, enrich_players), null, 2) }],
            })
        );

        this.server.tool(
            "get_league_users",
            "Get all users (managers) in a league.",
            { league_id: z.string() },
            async ({ league_id }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getLeagueUsers(league_id), null, 2) }],
            })
        );

        this.server.tool(
            "get_matchups",
            "Get matchup results and scores for a specific week with formatted display.",
            { 
                league_id: z.string(),
                week: z.number(),
                formatted: z.boolean().default(true).describe("Return formatted matchup display (true) or raw data (false)")
            },
            async ({ league_id, week, formatted }) => {
                const result = await this.sleeperApi.getMatchups(league_id, week, formatted);
                if (formatted && typeof result === 'string') {
                    return {
                        content: [{ type: "text", text: result }],
                    };
                } else {
                    return {
                        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                    };
                }
            }
        );

        this.server.tool(
            "get_user_drafts",
            "Get all drafts for a user in a specific sport and season.",
            {
                user_id: z.string(),
                sport: z.string().default("nfl"),
                season: z.string().default("2024")
            },
            async ({ user_id, sport, season }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getUserDrafts(user_id, sport, season), null, 2) }],
            })
        );

        this.server.tool(
            "get_draft_picks",
            "Get all picks from a specific draft with formatted table display.",
            { 
                draft_id: z.string(),
                formatted: z.boolean().default(true).describe("Return formatted table (true) or raw data (false)")
            },
            async ({ draft_id, formatted }) => {
                const result = await this.sleeperApi.getDraftPicks(draft_id, formatted);
                if (formatted && typeof result === 'string') {
                    return {
                        content: [{ type: "text", text: result }],
                    };
                } else {
                    return {
                        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                    };
                }
            }
        );

        this.server.tool(
            "get_trending_players",
            "Get players that are trending (being added/dropped) across leagues.",
            {
                sport: z.string().default("nfl"),
                trend_type: z.string().default("add"),
                enrich_players: z.boolean().default(true)
            },
            async ({ sport, trend_type, enrich_players }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getTrendingPlayers(sport, trend_type, enrich_players), null, 2) }],
            })
        );

        this.server.tool(
            "get_playoff_results",
            "Get the playoff results - use this to determine final standings for a league.",
            { league_id: z.string() },
            async ({ league_id }) => ({
                content: [{ type: "text", text: await this.sleeperApi.getPlayoffResults(league_id) }],
            })
        );

        this.server.tool(
            "get_nfl_state",
            "Get current NFL season state (week, season type, etc.).",
            {},
            async () => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getNflState(), null, 2) }],
            })
        );

        this.server.tool(
            "get_player_stats",
            "Get player statistics for a season, optionally grouped by week.",
            {
                player: z.string().describe("Player ID or player name (e.g., 'Josh Allen' or '4881')"),
                season: z.string().optional(),
                group_by_week: z.boolean().default(false)
            },
            async ({ player, season, group_by_week }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getPlayerStatsByName(player, season, group_by_week), null, 2) }],
            })
        );

        this.server.tool(
            "get_player_projections",
            "Get player projections with formatted table display.",
            {
                player: z.string().describe("Player ID or player name (e.g., 'Josh Allen' or '4881')"),
                season: z.string().optional(),
                formatted: z.boolean().default(true).describe("Return formatted table (true) or raw data (false)")
            },
            async ({ player, season, formatted }) => {
                const result = await this.sleeperApi.getPlayerProjectionsByName(player, season, formatted);
                if (formatted && result.formatted_table) {
                    return {
                        content: [{ type: "text", text: result.formatted_table }],
                    };
                } else {
                    return {
                        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                    };
                }
            }
        );

        this.server.tool(
            "get_player_news",
            "Get recent news articles for a player.",
            {
                player: z.string().describe("Player ID or player name (e.g., 'Josh Allen' or '4881')"),
                limit: z.number().default(2)
            },
            async ({ player, limit }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getPlayerNewsByName(player, limit), null, 2) }],
            })
        );

        this.server.tool(
            "get_player_ranks",
            "Get player rankings by PPR points for a season with formatted table.",
            {
                season: z.string().optional(),
                formatted: z.boolean().default(true).describe("Return formatted table (true) or raw data (false)")
            },
            async ({ season, formatted }) => {
                const result = await this.sleeperApi.getPlayerRanks(season, formatted);
                if (formatted && typeof result === 'string') {
                    return {
                        content: [{ type: "text", text: result }],
                    };
                } else {
                    return {
                        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                    };
                }
            }
        );

        this.server.tool(
            "get_regular_season_standings",
            "Returns the latest *regular season* standings for a league. For final standings in a historical season, make sure to check the playoff results as well.",
            {
                league_id: z.string()
            },
            async ({ league_id }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getLeagueStandings(league_id), null, 2) }],
            })
        );

        this.server.tool(
            "get_weekly_projections",
            "Get all player projections for a specific week.",
            {
                season: z.string().optional(),
                week: z.number().optional()
            },
            async ({ season, week }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getAllWeeklyProjections(season, week), null, 2) }],
            })
        );

        // Player search and utility tools

        this.server.tool(
            "search_players",
            "Search for players by name with fuzzy matching.",
            {
                query: z.string(),
                limit: z.number().default(10)
            },
            async ({ query, limit }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.searchPlayers(query, limit), null, 2) }],
            })
        );

        this.server.tool(
            "find_player_id",
            "Find a player's ID by name with confidence scoring.",
            {
                player_name: z.string()
            },
            async ({ player_name }) => {
                const result = await this.sleeperApi.getPlayerIdByName(player_name);
                if (result) {
                    return {
                        content: [{ 
                            type: "text", 
                            text: JSON.stringify({
                                player_id: result.playerId,
                                matched_name: result.matchedName,
                                confidence_score: result.score
                            }, null, 2) 
                        }],
                    };
                } else {
                    return {
                        content: [{ type: "text", text: `Player not found: ${player_name}` }],
                    };
                }
            }
        );
    }
}

export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        if (url.pathname === "/sse" || url.pathname === "/sse/message") {
            return SleeperMCP.serveSSE("/sse").fetch(request, env, ctx);
        }

        if (url.pathname === "/mcp") {
            return SleeperMCP.serve("/mcp").fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
};