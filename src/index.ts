import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import Fuse from "fuse.js";

interface Player {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
    status?: string;
    fantasy_positions?: string[];
}

interface PlayerSearchItem {
    id: string;
    name: string;
    position: string;
    team: string;
}

interface EnrichedPlayer {
    player_id: string;
    name: string;
    position: string;
    team: string;
    status: string;
    fantasy_positions: string[];
}

interface Match {
    m: number;
    r: number;
    t1?: number;
    t2?: number;
    t1_from?: { w?: number; l?: number };
    t2_from?: { w?: number; l?: number };
    w?: number;
    l?: number;
    p?: number;
}

interface CacheData {
    timestamp: number;
    players: Record<string, Player>;
}

interface NFLState {
    season: string;
    season_type: string;
    week: number;
    display_week: number;
    leg: number;
}

class SleeperAPI {
    private static readonly BASE_URL = "https://api.sleeper.app/v1";
    private static readonly STATS_URL = "https://api.sleeper.com/";
    private static readonly GRAPHQL_URL = "https://sleeper.com/graphql";
    private static readonly CACHE_KEY = "sleeper_players_cache";
    private static readonly CACHE_DURATION_HOURS = 24;
    
    private players: Record<string, Player> = {};
    private playersLoaded = false;
    private nflState: NFLState | null = null;
    private playerSearchItems: PlayerSearchItem[] = [];
    private playerFuse: Fuse<PlayerSearchItem> | null = null;

    private async ensurePlayersLoaded(): Promise<void> {
        if (!this.playersLoaded) {
            await this.loadPlayersCache();
            this.playersLoaded = true;
        }
    }

    async getUser(usernameOrId: string): Promise<any> {
        const url = `${SleeperAPI.BASE_URL}/user/${usernameOrId}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getUserLeagues(userId: string, sport: string = "nfl", season: string = "2024"): Promise<any[]> {
        const url = `${SleeperAPI.BASE_URL}/user/${userId}/leagues/${sport}/${season}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getLeague(leagueId: string): Promise<any> {
        const url = `${SleeperAPI.BASE_URL}/league/${leagueId}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getLeagueRosters(leagueId: string, enrichPlayers: boolean = true): Promise<any[]> {
        const url = `${SleeperAPI.BASE_URL}/league/${leagueId}/rosters`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const rosters = await response.json() as any[];

        if (enrichPlayers) {
            await this.ensurePlayersLoaded();
            for (const roster of rosters) {
                if (roster.players && roster.players.length > 0) {
                    roster.players_enriched = this.enrichPlayerIds(roster.players);
                }
                if (roster.starters && roster.starters.length > 0) {
                    roster.starters_enriched = this.enrichPlayerIds(roster.starters);
                }
                if (roster.reserve && roster.reserve.length > 0) {
                    roster.reserve_enriched = this.enrichPlayerIds(roster.reserve);
                }
            }
        }

        return rosters;
    }

    async getLeagueUsers(leagueId: string): Promise<any[]> {
        const url = `${SleeperAPI.BASE_URL}/league/${leagueId}/users`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getMatchups(leagueId: string, week: number): Promise<any[]> {
        const url = `${SleeperAPI.BASE_URL}/league/${leagueId}/matchups/${week}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getUserDrafts(userId: string, sport: string = "nfl", season: string = "2024"): Promise<any[]> {
        const url = `${SleeperAPI.BASE_URL}/user/${userId}/drafts/${sport}/${season}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getDraftPicks(draftId: string): Promise<any[]> {
        const url = `${SleeperAPI.BASE_URL}/draft/${draftId}/picks`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getPlayers(sport: string = "nfl"): Promise<Record<string, Player>> {
        const url = `${SleeperAPI.BASE_URL}/players/${sport}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getTrendingPlayers(sport: string = "nfl", trendType: string = "add", enrichPlayers: boolean = true): Promise<any[]> {
        const url = `${SleeperAPI.BASE_URL}/players/${sport}/trending/${trendType}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const trending = await response.json() as any[];

        if (enrichPlayers) {
            await this.ensurePlayersLoaded();
            for (const item of trending) {
                const playerId = item.player_id;
                if (playerId && this.players[playerId]) {
                    const player = this.players[playerId];
                    item.player_info = {
                        name: `${player.first_name || ''} ${player.last_name || ''}`.trim(),
                        position: player.position || '',
                        team: player.team || '',
                        status: player.status || '',
                        fantasy_positions: player.fantasy_positions || []
                    };
                } else {
                    item.player_info = {
                        name: "Unknown Player",
                        position: "",
                        team: "",
                        status: "Unknown",
                        fantasy_positions: []
                    };
                }
            }
        }

        return trending;
    }

    async getWinnersBracket(leagueId: string): Promise<Match[]> {
        const url = `${SleeperAPI.BASE_URL}/league/${leagueId}/winners_bracket`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getLosersBracket(leagueId: string): Promise<Match[]> {
        const url = `${SleeperAPI.BASE_URL}/league/${leagueId}/losers_bracket`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getPlayoffResults(leagueId: string): Promise<string> {
        const [winnersBracket, losersBracket, leagueUsers] = await Promise.all([
            this.getWinnersBracket(leagueId),
            this.getLosersBracket(leagueId),
            this.getLeagueUsers(leagueId)
        ]);

        const userMap: Record<string, string> = {};
        for (const user of leagueUsers) {
            userMap[user.user_id] = user.display_name || user.username || 'Unknown';
        }

        const rosters = await this.getLeagueRosters(leagueId, false);
        const rosterToUser: Record<number, string> = {};
        for (const roster of rosters) {
            rosterToUser[roster.roster_id] = userMap[roster.owner_id] || 'Unknown';
        }

        const result: string[] = [];

        if (winnersBracket && winnersBracket.length > 0) {
            result.push("🏆 WINNERS BRACKET");
            result.push("=".repeat(50));
            result.push(...this.formatBracket(winnersBracket, rosterToUser));
            result.push("");
        }

        if (losersBracket && losersBracket.length > 0) {
            result.push("🥉 LOSERS BRACKET");
            result.push("=".repeat(50));
            result.push(...this.formatBracket(losersBracket, rosterToUser));
            result.push("");
        }

        const finalStandings = this.generateFinalStandings(winnersBracket, losersBracket, rosterToUser);
        if (finalStandings && finalStandings.length > 0) {
            result.push("🏅 FINAL STANDINGS");
            result.push("=".repeat(50));
            result.push(...finalStandings);
        }

        return result.join("\n");
    }

    private formatBracket(bracket: Match[], rosterToUser: Record<number, string>): string[] {
        if (!bracket || bracket.length === 0) {
            return ["No bracket data available"];
        }

        const result: string[] = [];
        const rounds: Record<number, Match[]> = {};

        for (const match of bracket) {
            const roundNum = match.r;
            if (!rounds[roundNum]) {
                rounds[roundNum] = [];
            }
            rounds[roundNum].push(match);
        }

        for (const roundNum of Object.keys(rounds).map(Number).sort()) {
            result.push(`\nROUND ${roundNum}:`);
            result.push("-".repeat(20));

            const sortedMatches = rounds[roundNum].sort((a, b) => a.m - b.m);
            for (const match of sortedMatches) {
                const matchLine = this.formatMatch(match, rosterToUser);
                result.push(matchLine);
            }
        }

        return result;
    }

    private formatMatch(match: Match, rosterToUser: Record<number, string>): string {
        const matchId = match.m;

        const t1Name = this.getTeamName(match.t1, match.t1_from, rosterToUser);
        const t2Name = this.getTeamName(match.t2, match.t2_from, rosterToUser);

        let status: string;
        if (match.w !== undefined) {
            const winner = rosterToUser[match.w] || `Roster ${match.w}`;
            const loser = rosterToUser[match.l!] || `Roster ${match.l}`;
            status = `✅ ${winner} defeats ${loser}`;
        } else {
            status = "⏳ Pending";
        }

        const positionText = match.p ? ` (Position ${match.p})` : "";

        return `  Match ${matchId}: ${t1Name} vs ${t2Name} - ${status}${positionText}`;
    }

    private getTeamName(teamId?: number, teamFrom?: { w?: number; l?: number }, rosterToUser?: Record<number, string>): string {
        if (teamId !== undefined && rosterToUser) {
            return rosterToUser[teamId] || `Roster ${teamId}`;
        } else if (teamFrom) {
            if (teamFrom.w !== undefined) {
                return `Winner of Match ${teamFrom.w}`;
            } else if (teamFrom.l !== undefined) {
                return `Loser of Match ${teamFrom.l}`;
            }
        }
        return "TBD";
    }

    private generateFinalStandings(winnersBracket: Match[], losersBracket: Match[], rosterToUser: Record<number, string>): string[] | null {
        const allMatches = [...winnersBracket, ...losersBracket];

        if (!allMatches.every(match => match.w !== undefined)) {
            return null;
        }

        const standings: Record<number, string> = {};

        const winnersFinal = winnersBracket.reduce((max, match) => match.r > max.r ? match : max, winnersBracket[0]);
        if (winnersFinal && winnersFinal.w !== undefined) {
            standings[1] = rosterToUser[winnersFinal.w] || `Roster ${winnersFinal.w}`;
            standings[2] = rosterToUser[winnersFinal.l!] || `Roster ${winnersFinal.l}`;
        }

        for (const match of losersBracket) {
            if (match.p && match.w !== undefined && match.l !== undefined) {
                const position = match.p;
                const winner = rosterToUser[match.w] || `Roster ${match.w}`;
                const loser = rosterToUser[match.l] || `Roster ${match.l}`;

                if (position === 3) {
                    standings[3] = winner;
                    standings[4] = loser;
                } else if (position === 5) {
                    standings[5] = winner;
                    standings[6] = loser;
                } else if (position === 7) {
                    standings[7] = winner;
                    standings[8] = loser;
                }
            }
        }

        if (Object.keys(standings).length < 2) {
            return null;
        }

        const result: string[] = [];
        for (const pos of Object.keys(standings).map(Number).sort()) {
            if (pos === 1) {
                result.push(`🥇 1st Place: ${standings[pos]}`);
            } else if (pos === 2) {
                result.push(`🥈 2nd Place: ${standings[pos]}`);
            } else if (pos === 3) {
                result.push(`🥉 3rd Place: ${standings[pos]}`);
            } else {
                result.push(`   ${pos}th Place: ${standings[pos]}`);
            }
        }

        return result;
    }

    private async loadPlayersCache(): Promise<void> {
        const cacheData = await this.getCacheData();
        if (cacheData && this.isCacheValid(cacheData)) {
            this.players = cacheData.players;
            this.buildPlayerSearchIndex();
        } else {
            await this.refreshPlayersCache();
        }
    }

    private async getCacheData(): Promise<CacheData | null> {
        // In Cloudflare environment, we would use KV or Durable Objects
        // For now, we'll just fetch fresh data each time
        return null;
    }

    private isCacheValid(cacheData: CacheData): boolean {
        const cacheAge = Date.now() / 1000 - cacheData.timestamp;
        return cacheAge < (SleeperAPI.CACHE_DURATION_HOURS * 3600);
    }

    private async refreshPlayersCache(): Promise<void> {
        const playersData = await this.getPlayers();
        this.players = playersData;
        this.buildPlayerSearchIndex();

        // In a Cloudflare environment, you would save this to KV storage
        // await env.SLEEPER_CACHE.put(SleeperAPI.CACHE_KEY, JSON.stringify({
        //     timestamp: Date.now() / 1000,
        //     players: playersData
        // }));
    }

    private buildPlayerSearchIndex(): void {
        this.playerSearchItems = [];
        
        for (const [playerId, player] of Object.entries(this.players)) {
            const name = `${player.first_name || ''} ${player.last_name || ''}`.trim();
            if (name) {
                this.playerSearchItems.push({
                    id: playerId,
                    name,
                    position: player.position || '',
                    team: player.team || ''
                });
            }
        }

        const fuseOptions = {
            keys: [
                { name: 'name', weight: 0.8 },
                { name: 'position', weight: 0.1 },
                { name: 'team', weight: 0.1 }
            ],
            threshold: 0.3,
            includeScore: true
        };

        this.playerFuse = new Fuse(this.playerSearchItems, fuseOptions);
    }

    async getPlayerIdByName(playerName: string): Promise<{ playerId: string; matchedName: string; score?: number } | null> {
        await this.ensurePlayersLoaded();
        
        if (!this.playerFuse) {
            this.buildPlayerSearchIndex();
        }

        const results = this.playerFuse!.search(playerName, { limit: 1 });
        
        if (results.length > 0) {
            const match = results[0];
            return {
                playerId: match.item.id,
                matchedName: match.item.name,
                score: match.score
            };
        }

        return null;
    }

    async resolvePlayerInput(playerInput: string): Promise<string> {
        // If it looks like a player ID (all digits), return as-is
        if (/^\d+$/.test(playerInput)) {
            return playerInput;
        }

        // Otherwise, try fuzzy search
        const result = await this.getPlayerIdByName(playerInput);
        if (result) {
            return result.playerId;
        }

        throw new Error(`Player not found: ${playerInput}`);
    }

    async getNflState(): Promise<NFLState> {
        if (!this.nflState) {
            const url = `${SleeperAPI.BASE_URL}/state/nfl`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.nflState = await response.json() as NFLState;
        }
        return this.nflState;
    }

    async graphqlRequest(operationName: string, query: string, variables?: any): Promise<any> {
        const response = await fetch(SleeperAPI.GRAPHQL_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                operationName,
                variables: variables || {},
                query
            })
        });
        
        if (!response.ok) {
            throw new Error(`GraphQL HTTP error! status: ${response.status}`);
        }
        
        return response.json();
    }

    async getPlayerStats(playerId: string, season?: string, groupByWeek: boolean = false): Promise<any> {
        const nflState = await this.getNflState();
        const targetSeason = season || nflState.season;
        const groupQuery = groupByWeek ? "&grouping=week" : "";
        const url = `${SleeperAPI.STATS_URL}stats/nfl/player/${playerId}?season_type=regular&season=${targetSeason}${groupQuery}`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getPlayerProjections(playerId: string, season?: string): Promise<any> {
        const nflState = await this.getNflState();
        const targetSeason = season || nflState.season;
        const url = `${SleeperAPI.STATS_URL}projections/nfl/player/${playerId}?season_type=regular&season=${targetSeason}&grouping=week`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getPlayerNews(playerId: string, limit: number = 2): Promise<any[]> {
        const query = `query get_player_news_for_ids {
            news: get_player_news(sport: "nfl", player_id: "${playerId}", limit: ${limit}){
                metadata
                player_id
                published
                source
                source_key
                sport
            }
        }`;
        
        const result = await this.graphqlRequest('get_player_news_for_ids', query);
        return result.data.news;
    }

    async getPlayerRanks(season?: string): Promise<Record<string, any>> {
        const nflState = await this.getNflState();
        const targetSeason = season || nflState.season;
        const url = `${SleeperAPI.STATS_URL}stats/nfl/${targetSeason}?season_type=regular&position[]=DEF&position[]=K&position[]=QB&position[]=RB&position[]=TE&position[]=WR&order_by=pts_ppr`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json() as any[];
        
        const ranks: Record<string, any> = {};
        for (const player of data) {
            if (player.player_id && player.stats) {
                ranks[player.player_id] = {
                    rank_ppr: player.stats.rank_ppr,
                    pos_rank_ppr: player.stats.pos_rank_ppr
                };
            }
        }
        return ranks;
    }

    async getLeagueStandings(leagueId: string): Promise<any[]> {
        const query = `query metadata {
            metadata(type: "league_history", key: "${leagueId}"){
                key
                type
                data
                last_updated
                created
            }    
        }`;
        
        const result = await this.graphqlRequest('metadata', query);
        const standings = result.data.metadata.data.standings;
        
        return standings.sort((a: any, b: any) => {
            if (b.wins !== a.wins) return b.wins - a.wins;
            return b.fpts - a.fpts;
        });
    }

    async getAllWeeklyProjections(season?: string, week?: number): Promise<any[]> {
        const nflState = await this.getNflState();
        const targetSeason = season || nflState.season;
        const targetWeek = week || nflState.display_week;
        const url = `${SleeperAPI.STATS_URL}projections/nfl/${targetSeason}/${targetWeek}?season_type=regular&position[]=DEF&position[]=K&position[]=QB&position[]=RB&position[]=TE&position[]=WR&order_by=pts_ppr`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getEnrichedPlayers(season?: string, limit: number = 800): Promise<Record<string, any>> {
        const nflState = await this.getNflState();
        const targetSeason = season || nflState.season;
        
        const [projections, ranks] = await Promise.all([
            this.getAllWeeklyProjections(targetSeason),
            this.getPlayerRanks(targetSeason)
        ]);
        
        const result: Record<string, any> = {};
        const limitedProjections = limit ? projections.slice(0, limit) : projections;
        
        for (const projection of limitedProjections) {
            const playerId = projection.player_id;
            if (playerId && projection.player) {
                result[playerId] = {
                    ...projection.player,
                    ...(ranks[playerId] || {})
                };
            }
        }
        
        return result;
    }

    // Player name-friendly wrapper methods
    async getPlayerStatsByName(playerNameOrId: string, season?: string, groupByWeek: boolean = false): Promise<any> {
        const playerId = await this.resolvePlayerInput(playerNameOrId);
        return this.getPlayerStats(playerId, season, groupByWeek);
    }

    async getPlayerProjectionsByName(playerNameOrId: string, season?: string, formatted: boolean = true): Promise<any> {
        const playerId = await this.resolvePlayerInput(playerNameOrId);
        const projections = await this.getPlayerProjections(playerId, season);
        
        if (formatted) {
            return {
                formatted_table: this.formatProjectionsTable(projections),
                raw_data: projections
            };
        }
        
        return projections;
    }

    async getPlayerNewsByName(playerNameOrId: string, limit: number = 2): Promise<any[]> {
        const playerId = await this.resolvePlayerInput(playerNameOrId);
        return this.getPlayerNews(playerId, limit);
    }

    async searchPlayers(query: string, limit: number = 10): Promise<PlayerSearchItem[]> {
        await this.ensurePlayersLoaded();
        
        if (!this.playerFuse) {
            this.buildPlayerSearchIndex();
        }

        const results = this.playerFuse!.search(query, { limit });
        return results.map(result => result.item);
    }

    private formatProjectionsTable(projections: any): string {
        if (!projections || typeof projections !== 'object') {
            return "No projections data available";
        }

        const weeks = Object.keys(projections)
            .filter(key => projections[key] !== null)
            .sort((a, b) => parseInt(a) - parseInt(b));

        if (weeks.length === 0) {
            return "No projection weeks available";
        }

        // Get first valid week to determine player position/stats available
        const firstWeek = projections[weeks[0]];
        const stats = firstWeek.stats || {};
        const hasPassingStats = stats.pass_yd !== undefined;
        const hasReceivingStats = stats.rec !== undefined;
        const hasRushingStats = stats.rush_yd !== undefined;

        // Create position-specific headers
        let header = "Week | Date       | Opp";
        let separator = "";
        
        if (hasPassingStats) {
            header += " | Pass Yds | Pass TDs";
        }
        if (hasRushingStats) {
            header += " | Rush Yds | Rush TDs";
        }
        if (hasReceivingStats) {
            header += " | Rec | Rec Yds | Rec TDs";
        }
        header += " | PPR Pts";
        
        separator = "-".repeat(header.length);
        
        const rows = weeks.map(week => {
            const proj = projections[week];
            const stats = proj.stats || {};
            
            const weekNum = week.toString().padStart(2);
            const date = proj.date ? new Date(proj.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : 'TBD';
            const opponent = proj.opponent || 'TBD';
            
            let row = `${weekNum}   | ${date.padEnd(10)} | ${opponent.padEnd(3)}`;
            
            if (hasPassingStats) {
                const passYds = Math.round(stats.pass_yd || 0).toString().padStart(8);
                const passTds = (stats.pass_td || 0).toFixed(1).padStart(8);
                row += ` | ${passYds} | ${passTds}`;
            }
            
            if (hasRushingStats) {
                const rushYds = Math.round(stats.rush_yd || 0).toString().padStart(8);
                const rushTds = (stats.rush_td || 0).toFixed(1).padStart(8);
                row += ` | ${rushYds} | ${rushTds}`;
            }
            
            if (hasReceivingStats) {
                const receptions = (stats.rec || 0).toFixed(1).padStart(3);
                const recYds = Math.round(stats.rec_yd || 0).toString().padStart(7);
                const recTds = (stats.rec_td || 0).toFixed(1).padStart(7);
                row += ` | ${receptions} | ${recYds} | ${recTds}`;
            }
            
            const fantasyPts = (stats.pts_ppr || 0).toFixed(1).padStart(7);
            row += ` | ${fantasyPts}`;
            
            return row;
        });

        return [header, separator, ...rows].join('\n');
    }

    private enrichPlayerIds(playerIds: string[]): EnrichedPlayer[] {
        const enrichedPlayers: EnrichedPlayer[] = [];
        for (const playerId of playerIds) {
            if (this.players[playerId]) {
                const player = this.players[playerId];
                enrichedPlayers.push({
                    player_id: playerId,
                    name: `${player.first_name || ''} ${player.last_name || ''}`.trim(),
                    position: player.position || '',
                    team: player.team || '',
                    status: player.status || '',
                    fantasy_positions: player.fantasy_positions || []
                });
            } else {
                enrichedPlayers.push({
                    player_id: playerId,
                    name: "Unknown Player",
                    position: "",
                    team: "",
                    status: "Unknown",
                    fantasy_positions: []
                });
            }
        }
        return enrichedPlayers;
    }
}

export class SleeperMCP extends McpAgent {
    server = new McpServer({
        name: "Sleeper API",
        version: "1.0.0",
    });

    private sleeperApi = new SleeperAPI();

    async init() {
        this.server.tool(
            "get_user", 
            { username_or_id: z.string() }, 
            async ({ username_or_id }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getUser(username_or_id), null, 2) }],
            })
        );

        this.server.tool(
            "get_user_leagues",
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
            { league_id: z.string() },
            async ({ league_id }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getLeague(league_id), null, 2) }],
            })
        );

        this.server.tool(
            "get_league_rosters",
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
            { league_id: z.string() },
            async ({ league_id }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getLeagueUsers(league_id), null, 2) }],
            })
        );

        this.server.tool(
            "get_matchups",
            { 
                league_id: z.string(),
                week: z.number()
            },
            async ({ league_id, week }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getMatchups(league_id, week), null, 2) }],
            })
        );

        this.server.tool(
            "get_user_drafts",
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
            { draft_id: z.string() },
            async ({ draft_id }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getDraftPicks(draft_id), null, 2) }],
            })
        );

        this.server.tool(
            "get_trending_players",
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
            { league_id: z.string() },
            async ({ league_id }) => ({
                content: [{ type: "text", text: await this.sleeperApi.getPlayoffResults(league_id) }],
            })
        );

        this.server.tool(
            "get_winners_bracket",
            { league_id: z.string() },
            async ({ league_id }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getWinnersBracket(league_id), null, 2) }],
            })
        );

        this.server.tool(
            "get_losers_bracket",
            { league_id: z.string() },
            async ({ league_id }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getLosersBracket(league_id), null, 2) }],
            })
        );

        this.server.tool(
            "get_nfl_state",
            {},
            async () => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getNflState(), null, 2) }],
            })
        );

        this.server.tool(
            "get_player_stats",
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
            {
                season: z.string().optional()
            },
            async ({ season }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getPlayerRanks(season), null, 2) }],
            })
        );

        this.server.tool(
            "get_league_standings",
            {
                league_id: z.string()
            },
            async ({ league_id }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getLeagueStandings(league_id), null, 2) }],
            })
        );

        this.server.tool(
            "get_weekly_projections",
            {
                season: z.string().optional(),
                week: z.number().optional()
            },
            async ({ season, week }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getAllWeeklyProjections(season, week), null, 2) }],
            })
        );

        this.server.tool(
            "get_enriched_players",
            {
                season: z.string().optional(),
                limit: z.number().default(800)
            },
            async ({ season, limit }) => ({
                content: [{ type: "text", text: JSON.stringify(await this.sleeperApi.getEnrichedPlayers(season, limit), null, 2) }],
            })
        );

        // Player search and utility tools

        this.server.tool(
            "search_players",
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