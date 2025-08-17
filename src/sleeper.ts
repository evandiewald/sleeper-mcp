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
    private playersCache: CacheData | null = null;

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

    async getMatchups(leagueId: string, week: number, formatted: boolean = true): Promise<any[] | string> {
        const url = `${SleeperAPI.BASE_URL}/league/${leagueId}/matchups/${week}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const matchups = await response.json() as any[];
        
        if (formatted) {
            await this.ensurePlayersLoaded();
            const [users, rosters] = await Promise.all([
                this.getLeagueUsers(leagueId),
                this.getLeagueRosters(leagueId, false)
            ]);
            
            return this.formatMatchupsTable(matchups as any[], users as any[], rosters as any[], week);
        }
        
        return matchups;
    }

    async getUserDrafts(userId: string, sport: string = "nfl", season: string = "2024"): Promise<any[]> {
        const url = `${SleeperAPI.BASE_URL}/user/${userId}/drafts/${sport}/${season}`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    async getDraftPicks(draftId: string, formatted: boolean = true): Promise<any[] | string> {
        const url = `${SleeperAPI.BASE_URL}/draft/${draftId}/picks`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const picks = await response.json();
        
        if (formatted) {
            // Get league users to map roster_id to team names
            const draftResponse = await fetch(`${SleeperAPI.BASE_URL}/draft/${draftId}`);
            if (!draftResponse.ok) {
                throw new Error(`HTTP error getting draft info! status: ${draftResponse.status}`);
            }
            const draft = await draftResponse.json() as any;
            const leagueId = draft.league_id;
            
            const [users, rosters] = await Promise.all([
                this.getLeagueUsers(leagueId),
                this.getLeagueRosters(leagueId, false)
            ]);
            
            return this.formatDraftPicksTable(picks as any[], users as any[], rosters as any[]);
        }
        
        return picks;
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
        return this.playersCache;
    }

    private isCacheValid(cacheData: CacheData): boolean {
        const cacheAge = Date.now() / 1000 - cacheData.timestamp;
        return cacheAge < (SleeperAPI.CACHE_DURATION_HOURS * 3600);
    }

    private async refreshPlayersCache(): Promise<void> {
        const playersData = await this.getPlayers();
        this.players = playersData;
        
        // Save to in-memory cache with current timestamp
        this.playersCache = {
            timestamp: Math.floor(Date.now() / 1000),
            players: playersData
        };
        
        this.buildPlayerSearchIndex();
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

    async getPlayerRanks(season?: string, formatted: boolean = true): Promise<Record<string, any> | string> {
        const nflState = await this.getNflState();
        const targetSeason = season || nflState.season;
        const url = `${SleeperAPI.STATS_URL}stats/nfl/${targetSeason}?season_type=regular&position[]=DEF&position[]=K&position[]=QB&position[]=RB&position[]=TE&position[]=WR&order_by=pts_ppr`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json() as any[];
        
        if (formatted) {
            await this.ensurePlayersLoaded();
            return this.formatPlayerRanksTable(data);
        }
        
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
            this.getPlayerRanks(targetSeason, false)
        ]);
        
        const result: Record<string, any> = {};
        const limitedProjections = limit ? projections.slice(0, limit) : projections;
        const ranksData = ranks as Record<string, any>;
        
        for (const projection of limitedProjections) {
            const playerId = projection.player_id;
            if (playerId && projection.player) {
                result[playerId] = {
                    ...projection.player,
                    ...(ranksData[playerId] || {})
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

    private formatMatchupsTable(matchups: any[], users: any[], rosters: any[], week: number): string {
        if (!matchups || matchups.length === 0) {
            return "No matchup data available";
        }

        // Create mapping from roster_id to user display name
        const userMap: Record<string, string> = {};
        for (const user of users) {
            userMap[user.user_id] = user.display_name || user.username || 'Unknown';
        }
        
        const rosterToUser: Record<number, string> = {};
        for (const roster of rosters) {
            rosterToUser[roster.roster_id] = userMap[roster.owner_id] || 'Unknown';
        }

        // Group matchups by matchup_id
        const matchupGroups: Record<number, any[]> = {};
        for (const matchup of matchups) {
            if (!matchupGroups[matchup.matchup_id]) {
                matchupGroups[matchup.matchup_id] = [];
            }
            matchupGroups[matchup.matchup_id].push(matchup);
        }

        const result: string[] = [];
        result.push(`WEEK ${week} MATCHUPS`);
        result.push("=".repeat(80));
        result.push("");

        for (const matchupId of Object.keys(matchupGroups).sort()) {
            const teams = matchupGroups[parseInt(matchupId)];
            if (teams.length === 2) {
                const [team1, team2] = teams.sort((a, b) => b.points - a.points); // Higher score first
                const winner = team1.points > team2.points ? team1 : (team2.points > team1.points ? team2 : null);
                
                result.push(`MATCHUP ${matchupId}`);
                result.push("-".repeat(40));
                
                // Team 1
                const team1Name = rosterToUser[team1.roster_id] || 'Unknown';
                const team1Score = team1.points.toFixed(2);
                const winnerIndicator1 = winner && winner.roster_id === team1.roster_id ? " 🏆" : "";
                result.push(`${team1Name}: ${team1Score}${winnerIndicator1}`);
                
                // Team 1 starters
                const team1Starters = this.formatStarters(team1.starters, team1.starters_points);
                result.push(team1Starters);
                result.push("");
                
                // Team 2
                const team2Name = rosterToUser[team2.roster_id] || 'Unknown';
                const team2Score = team2.points.toFixed(2);
                const winnerIndicator2 = winner && winner.roster_id === team2.roster_id ? " 🏆" : "";
                result.push(`${team2Name}: ${team2Score}${winnerIndicator2}`);
                
                // Team 2 starters
                const team2Starters = this.formatStarters(team2.starters, team2.starters_points);
                result.push(team2Starters);
                result.push("");
            }
        }

        return result.join('\n');
    }

    private formatStarters(starters: string[], starterPoints: number[]): string {
        const lines: string[] = [];
        
        for (let i = 0; i < starters.length; i++) {
            const playerId = starters[i];
            const points = starterPoints[i]?.toFixed(1) || '0.0';
            
            let playerInfo = 'Unknown Player';
            if (playerId === '0') {
                playerInfo = 'Empty Slot';
            } else if (playerId.length <= 3 && /^[A-Z]+$/.test(playerId)) {
                // Defense (e.g., "BAL", "KC")
                playerInfo = `${playerId} DST`;
            } else if (this.players[playerId]) {
                const player = this.players[playerId];
                const name = `${player.first_name || ''} ${player.last_name || ''}`.trim();
                const position = player.position || 'N/A';
                const team = player.team || 'N/A';
                playerInfo = `${name} (${position}, ${team})`;
            }
            
            lines.push(`  ${playerInfo.padEnd(35)} ${points.padStart(6)} pts`);
        }
        
        return lines.join('\n');
    }

    private formatDraftPicksTable(picks: any[], users: any[], rosters: any[]): string {
        if (!picks || picks.length === 0) {
            return "No draft picks data available";
        }

        // Create mapping from roster_id to user display name
        const userMap: Record<string, string> = {};
        for (const user of users) {
            userMap[user.user_id] = user.display_name || user.username || 'Unknown';
        }
        
        const rosterToUser: Record<number, string> = {};
        for (const roster of rosters) {
            rosterToUser[roster.roster_id] = userMap[roster.owner_id] || 'Unknown';
        }

        const header = "Round | Pick | Player Name                | Pos | NFL Team | Drafted By Team";
        const separator = "-".repeat(header.length);
        
        const rows = picks.map(pick => {
            const round = pick.round.toString().padStart(5);
            const pickNo = pick.pick_no.toString().padStart(4);
            
            const firstName = pick.metadata?.first_name || '';
            const lastName = pick.metadata?.last_name || '';
            const playerName = `${firstName} ${lastName}`.trim() || 'Unknown Player';
            const paddedName = playerName.padEnd(26);
            
            const position = (pick.metadata?.position || 'N/A').padEnd(3);
            const nflTeam = (pick.metadata?.team || 'N/A').padEnd(8);
            const draftedBy = (rosterToUser[pick.roster_id] || 'Unknown').padEnd(15);
            
            return `${round} | ${pickNo} | ${paddedName} | ${position} | ${nflTeam} | ${draftedBy}`;
        });

        return [header, separator, ...rows].join('\n');
    }

    private formatPlayerRanksTable(data: any[]): string {
        if (!data || data.length === 0) {
            return "No player rankings data available";
        }

        // Sort by overall PPR rank
        const sortedPlayers = data
            .filter(player => player.player_id && player.stats && player.stats.rank_ppr)
            .sort((a, b) => a.stats.rank_ppr - b.stats.rank_ppr)
            .slice(0, 200); // Limit to top 200 for readability

        const header = "Rank | Pos Rank | Player Name                | Pos | Team | PPR Pts";
        const separator = "-".repeat(header.length);
        
        const rows = sortedPlayers.map(playerData => {
            const playerId = playerData.player_id;
            const stats = playerData.stats;
            const player = this.players[playerId];
            
            const rank = stats.rank_ppr.toString().padStart(4);
            const posRank = stats.pos_rank_ppr.toString().padStart(8);
            const name = player ? `${player.first_name || ''} ${player.last_name || ''}`.trim() : 'Unknown Player';
            const paddedName = name.padEnd(26);
            const position = (player?.position || 'N/A').padEnd(3);
            const team = (player?.team || 'N/A').padEnd(4);
            const pprPts = (stats.pts_ppr || 0).toFixed(1).padStart(7);
            
            return `${rank} | ${posRank} | ${paddedName} | ${position} | ${team} | ${pprPts}`;
        });

        return [header, separator, ...rows].join('\n');
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

export default SleeperAPI;