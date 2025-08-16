"""Sleeper MCP Server implementation."""

import asyncio
import json
import os
import time
from typing import Any, Dict, List, Optional
from mcp.server.fastmcp import FastMCP

import httpx


class SleeperAPI:
    """Client for interacting with the Sleeper API."""
    
    BASE_URL = "https://api.sleeper.app/v1"
    CACHE_FILE = "sleeper_players_cache.json"
    CACHE_DURATION_HOURS = 24
    
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)
        self.players: Dict[str, Any] = {}
        self._players_loaded = False
        
    async def _ensure_players_loaded(self):
        """Ensure players data is loaded before using it."""
        if not self._players_loaded:
            await self._load_players_cache()
            self._players_loaded = True
    
    async def get_user(self, username_or_id: str) -> Dict[str, Any]:
        """Get user by username or user ID."""
        url = f"{self.BASE_URL}/user/{username_or_id}"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json()
    
    async def get_user_leagues(self, user_id: str, sport: str = "nfl", season: str = "2024") -> List[Dict[str, Any]]:
        """Get leagues for a user."""
        url = f"{self.BASE_URL}/user/{user_id}/leagues/{sport}/{season}"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json()
    
    async def get_league(self, league_id: str) -> Dict[str, Any]:
        """Get league information."""
        url = f"{self.BASE_URL}/league/{league_id}"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json()
    
    async def get_league_rosters(self, league_id: str, enrich_players: bool = True) -> List[Dict[str, Any]]:
        """Get rosters for a league with optional player enrichment."""
        url = f"{self.BASE_URL}/league/{league_id}/rosters"
        response = await self.client.get(url)
        response.raise_for_status()
        rosters = response.json()
        
        if enrich_players:
            await self._ensure_players_loaded()
            for roster in rosters:
                if 'players' in roster and roster['players']:
                    roster['players_enriched'] = self._enrich_player_ids(roster['players'])
                if 'starters' in roster and roster['starters']:
                    roster['starters_enriched'] = self._enrich_player_ids(roster['starters'])
                if 'reserve' in roster and roster['reserve']:
                    roster['reserve_enriched'] = self._enrich_player_ids(roster['reserve'])
        
        return rosters
    
    async def get_league_users(self, league_id: str) -> List[Dict[str, Any]]:
        """Get users in a league."""
        url = f"{self.BASE_URL}/league/{league_id}/users"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json()
    
    async def get_matchups(self, league_id: str, week: int) -> List[Dict[str, Any]]:
        """Get matchups for a specific week."""
        url = f"{self.BASE_URL}/league/{league_id}/matchups/{week}"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json()
    
    async def get_user_drafts(self, user_id: str, sport: str = "nfl", season: str = "2024") -> List[Dict[str, Any]]:
        """Get drafts for a user."""
        url = f"{self.BASE_URL}/user/{user_id}/drafts/{sport}/{season}"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json()
    
    async def get_draft_picks(self, draft_id: str) -> List[Dict[str, Any]]:
        """Get picks for a draft."""
        url = f"{self.BASE_URL}/draft/{draft_id}/picks"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json()
    
    async def get_players(self, sport: str = "nfl") -> Dict[str, Any]:
        """Get all players."""
        url = f"{self.BASE_URL}/players/{sport}"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json()
    
    async def get_trending_players(self, sport: str = "nfl", trend_type: str = "add", enrich_players: bool = True) -> List[Dict[str, Any]]:
        """Get trending players with optional player enrichment."""
        url = f"{self.BASE_URL}/players/{sport}/trending/{trend_type}"
        response = await self.client.get(url)
        response.raise_for_status()
        trending = response.json()
        
        if enrich_players:
            await self._ensure_players_loaded()
            for item in trending:
                player_id = item.get('player_id')
                if player_id and player_id in self.players:
                    player = self.players[player_id]
                    item['player_info'] = {
                        "name": f"{player.get('first_name', '')} {player.get('last_name', '')}".strip(),
                        "position": player.get('position', ''),
                        "team": player.get('team', ''),
                        "status": player.get('status', ''),
                        "fantasy_positions": player.get('fantasy_positions', [])
                    }
                else:
                    item['player_info'] = {
                        "name": "Unknown Player",
                        "position": "",
                        "team": "",
                        "status": "Unknown",
                        "fantasy_positions": []
                    }
        
        return trending
    
    async def get_winners_bracket(self, league_id: str) -> List[Dict[str, Any]]:
        """Get winners bracket for a league."""
        url = f"{self.BASE_URL}/league/{league_id}/winners_bracket"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json()
    
    async def get_losers_bracket(self, league_id: str) -> List[Dict[str, Any]]:
        """Get losers bracket for a league."""
        url = f"{self.BASE_URL}/league/{league_id}/losers_bracket"
        response = await self.client.get(url)
        response.raise_for_status()
        return response.json()
    
    async def get_playoff_results(self, league_id: str) -> str:
        """Get formatted playoff results with winners and losers brackets."""
        # Get bracket data and league users
        winners_bracket, losers_bracket, league_users = await asyncio.gather(
            self.get_winners_bracket(league_id),
            self.get_losers_bracket(league_id),
            self.get_league_users(league_id)
        )
        
        # Create roster_id to username mapping
        user_map = {user['user_id']: user.get('display_name', user.get('username', 'Unknown')) for user in league_users}
        rosters = await self.get_league_rosters(league_id, enrich_players=False)
        roster_to_user = {roster['roster_id']: user_map.get(roster['owner_id'], 'Unknown') for roster in rosters}
        
        result = []
        
        # Format Winners Bracket
        if winners_bracket:
            result.append("🏆 WINNERS BRACKET")
            result.append("=" * 50)
            result.extend(self._format_bracket(winners_bracket, roster_to_user))
            result.append("")
        
        # Format Losers Bracket
        if losers_bracket:
            result.append("🥉 LOSERS BRACKET")
            result.append("=" * 50)
            result.extend(self._format_bracket(losers_bracket, roster_to_user))
            result.append("")
        
        # Check if playoffs are complete and add final standings
        final_standings = self._generate_final_standings(winners_bracket, losers_bracket, roster_to_user)
        if final_standings:
            result.append("🏅 FINAL STANDINGS")
            result.append("=" * 50)
            result.extend(final_standings)
        
        return "\n".join(result)
    
    def _format_bracket(self, bracket: List[Dict[str, Any]], roster_to_user: Dict[int, str]) -> List[str]:
        """Format a bracket (winners or losers) into readable text."""
        if not bracket:
            return ["No bracket data available"]
        
        result = []
        rounds = {}
        
        # Group matches by round
        for match in bracket:
            round_num = match['r']
            if round_num not in rounds:
                rounds[round_num] = []
            rounds[round_num].append(match)
        
        # Format each round
        for round_num in sorted(rounds.keys()):
            result.append(f"\nROUND {round_num}:")
            result.append("-" * 20)
            
            for match in sorted(rounds[round_num], key=lambda x: x['m']):
                match_line = self._format_match(match, roster_to_user)
                result.append(match_line)
        
        return result
    
    def _format_match(self, match: Dict[str, Any], roster_to_user: Dict[int, str]) -> str:
        """Format a single match into readable text."""
        match_id = match['m']
        
        # Get team names
        t1_name = self._get_team_name(match.get('t1'), match.get('t1_from'), roster_to_user)
        t2_name = self._get_team_name(match.get('t2'), match.get('t2_from'), roster_to_user)
        
        # Format the match
        if match.get('w') is not None:
            winner = roster_to_user.get(match['w'], f"Roster {match['w']}")
            loser = roster_to_user.get(match['l'], f"Roster {match['l']}")
            status = f"✅ {winner} defeats {loser}"
        else:
            status = "⏳ Pending"
        
        # Add playoff position if available
        position_text = ""
        if match.get('p'):
            position_text = f" (Position {match['p']})"
        
        return f"  Match {match_id}: {t1_name} vs {t2_name} - {status}{position_text}"
    
    def _get_team_name(self, team_id: Optional[int], team_from: Optional[Dict[str, int]], roster_to_user: Dict[int, str]) -> str:
        """Get team name from roster_id or team_from reference."""
        if team_id is not None:
            return roster_to_user.get(team_id, f"Roster {team_id}")
        elif team_from:
            if 'w' in team_from:
                return f"Winner of Match {team_from['w']}"
            elif 'l' in team_from:
                return f"Loser of Match {team_from['l']}"
        return "TBD"
    
    def _generate_final_standings(self, winners_bracket: List[Dict[str, Any]], losers_bracket: List[Dict[str, Any]], roster_to_user: Dict[int, str]) -> Optional[List[str]]:
        """Generate final standings if playoffs are complete."""
        all_matches = winners_bracket + losers_bracket
        
        # Check if all matches are complete
        if not all(match.get('w') is not None for match in all_matches):
            return None
        
        standings = {}
        
        # Find the championship match (highest round in winners bracket)
        winners_final = max(winners_bracket, key=lambda x: x['r']) if winners_bracket else None
        if winners_final and winners_final.get('w'):
            standings[1] = roster_to_user.get(winners_final['w'], f"Roster {winners_final['w']}")
            standings[2] = roster_to_user.get(winners_final['l'], f"Roster {winners_final['l']}")
        
        # Process position-determining matches from losers bracket
        for match in losers_bracket:
            if match.get('p'):  # Match determines final position
                position = match['p']
                winner = roster_to_user.get(match['w'], f"Roster {match['w']}")
                loser = roster_to_user.get(match['l'], f"Roster {match['l']}")
                
                if position == 3:  # 3rd place match
                    standings[3] = winner
                    standings[4] = loser
                elif position == 5:  # 5th place match
                    standings[5] = winner
                    standings[6] = loser
                elif position == 7:  # 7th place match
                    standings[7] = winner
                    standings[8] = loser
        
        # If we don't have clear standings, try to infer from bracket structure
        if len(standings) < 2:
            return None
        
        result = []
        for pos in sorted(standings.keys()):
            if pos == 1:
                result.append(f"🥇 1st Place: {standings[pos]}")
            elif pos == 2:
                result.append(f"🥈 2nd Place: {standings[pos]}")
            elif pos == 3:
                result.append(f"🥉 3rd Place: {standings[pos]}")
            else:
                result.append(f"   {pos}th Place: {standings[pos]}")
        
        return result
    
    async def _load_players_cache(self):
        """Load players data from cache or fetch fresh data."""
        if self._is_cache_valid():
            with open(self.CACHE_FILE, 'r') as f:
                cache_data = json.load(f)
                self.players = cache_data['players']
        else:
            await self._refresh_players_cache()
    
    def _is_cache_valid(self) -> bool:
        """Check if the cache file exists and is not expired."""
        if not os.path.exists(self.CACHE_FILE):
            return False
        
        cache_age = time.time() - os.path.getmtime(self.CACHE_FILE)
        return cache_age < (self.CACHE_DURATION_HOURS * 3600)
    
    async def _refresh_players_cache(self):
        """Fetch fresh players data and save to cache."""
        players_data = await self.get_players()
        self.players = players_data
        
        cache_data = {
            'timestamp': time.time(),
            'players': players_data
        }
        
        with open(self.CACHE_FILE, 'w') as f:
            json.dump(cache_data, f, indent=2)
    
    def _enrich_player_ids(self, player_ids: List[str]) -> List[Dict[str, Any]]:
        """Convert player IDs to enriched player information."""
        enriched_players = []
        for player_id in player_ids:
            if player_id in self.players:
                player = self.players[player_id]
                enriched_players.append({
                    "player_id": player_id,
                    "name": f"{player.get('first_name', '')} {player.get('last_name', '')}".strip(),
                    "position": player.get('position', ''),
                    "team": player.get('team', ''),
                    "status": player.get('status', ''),
                    "fantasy_positions": player.get('fantasy_positions', [])
                })
            else:
                enriched_players.append({
                    "player_id": player_id,
                    "name": "Unknown Player",
                    "position": "",
                    "team": "",
                    "status": "Unknown",
                    "fantasy_positions": []
                })
        return enriched_players

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()


# FastMCP Server Implementation
mcp = FastMCP("Sleeper API")
sleeper_api = SleeperAPI()

@mcp.tool()
async def get_user(username_or_id: str) -> Dict[str, Any]:
    """Get user information by username or user ID."""
    return await sleeper_api.get_user(username_or_id)

@mcp.tool()
async def get_user_leagues(user_id: str, sport: str = "nfl", season: str = "2024") -> List[Dict[str, Any]]:
    """Get leagues for a user."""
    return await sleeper_api.get_user_leagues(user_id, sport, season)

@mcp.tool()
async def get_league(league_id: str) -> Dict[str, Any]:
    """Get league information."""
    return await sleeper_api.get_league(league_id)

@mcp.tool()
async def get_league_rosters(league_id: str, enrich_players: bool = True) -> List[Dict[str, Any]]:
    """Get rosters for a league with optional player enrichment."""
    return await sleeper_api.get_league_rosters(league_id, enrich_players)

@mcp.tool()
async def get_league_users(league_id: str) -> List[Dict[str, Any]]:
    """Get users in a league."""
    return await sleeper_api.get_league_users(league_id)

@mcp.tool()
async def get_matchups(league_id: str, week: int) -> List[Dict[str, Any]]:
    """Get matchups for a specific week."""
    return await sleeper_api.get_matchups(league_id, week)

@mcp.tool()
async def get_user_drafts(user_id: str, sport: str = "nfl", season: str = "2024") -> List[Dict[str, Any]]:
    """Get drafts for a user."""
    return await sleeper_api.get_user_drafts(user_id, sport, season)

@mcp.tool()
async def get_draft_picks(draft_id: str) -> List[Dict[str, Any]]:
    """Get picks for a draft."""
    return await sleeper_api.get_draft_picks(draft_id)

@mcp.tool()
async def get_trending_players(sport: str = "nfl", trend_type: str = "add", enrich_players: bool = True) -> List[Dict[str, Any]]:
    """Get trending players (add/drop) with optional player enrichment."""
    return await sleeper_api.get_trending_players(sport, trend_type, enrich_players)

@mcp.tool()
async def get_playoff_results(league_id: str) -> str:
    """Get formatted playoff bracket results with winners and losers brackets."""
    return await sleeper_api.get_playoff_results(league_id)

@mcp.tool()
async def get_winners_bracket(league_id: str) -> List[Dict[str, Any]]:
    """Get raw winners bracket data for a league."""
    return await sleeper_api.get_winners_bracket(league_id)

@mcp.tool()
async def get_losers_bracket(league_id: str) -> List[Dict[str, Any]]:
    """Get raw losers bracket data for a league."""
    return await sleeper_api.get_losers_bracket(league_id)
