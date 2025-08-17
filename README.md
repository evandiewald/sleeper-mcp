# Sleeper MCP Server

A Model Context Protocol (MCP) server that provides access to the Sleeper fantasy football API. This server enables AI assistants to retrieve fantasy football data including leagues, rosters, player stats, projections, and more.

## Remote Server URL

The publicly-hosted server can be accessed via clients like Claude Desktop using the following URL:

`https://sleeper-mcp.evandiewald.workers.dev/sse`

## Features

### Core League Data
- **User & League Info**: Get user details and league information
- **Rosters & Matchups**: View team rosters and weekly matchup results
- **Standings**: Regular season standings and playoff brackets
- **Drafts**: Access draft picks and draft history

### Player Data
- **Player Search**: Fuzzy search for players by name
- **Statistics**: Historical player stats (season or weekly)
- **Projections**: Fantasy projections with formatted tables
- **News**: Recent player news articles
- **Rankings**: Season-long player rankings by PPR points
- **Trending**: Players being added/dropped across leagues

### NFL State
- **Current Season Info**: Get current week, season type, and schedule data
- **Weekly Projections**: All player projections for specific weeks

## Installation & Setup

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Local Development

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd sleeper-mcp
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

   The server will be available at:
   - MCP endpoint: `http://localhost:8787/mcp`
   - SSE endpoint: `http://localhost:8787/sse`

### Remote Deployment (Cloudflare Workers)

1. **Install Wrangler CLI**:
   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare**:
   ```bash
   wrangler login
   ```

3. **Deploy the server**:
   ```bash
   npm run deploy
   ```

   After deployment, your server will be available at:
   ```
   https://your-worker-name.your-subdomain.workers.dev/mcp
   ```

## Connecting to Claude Desktop

### Local Connection

Add this configuration to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sleeper": {
      "command": "node",
      "args": ["-e", "require('http').createServer((req,res)=>{if(req.url==='/mcp'){require('./dist/index.js').default.fetch(req).then(r=>r.text()).then(t=>res.end(t))}else{res.end('404')}}).listen(8787)"],
      "cwd": "/path/to/sleeper-mcp"
    }
  }
}
```

### Remote Connection

For a deployed Cloudflare Worker:

```json
{
  "mcpServers": {
    "sleeper": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch", "https://your-worker-name.your-subdomain.workers.dev/mcp"]
    }
  }
}
```

## Available Tools

### User & League Management
- `get_user` - Get user information by username or user ID
- `get_user_leagues` - Get all leagues for a user in a specific sport and season
- `get_league` - Get league information and settings
- `get_league_users` - Get all users (managers) in a league

### Roster & Matchup Data
- `get_league_rosters` - Get all team rosters in a league with optional player enrichment
- `get_matchups` - Get matchup results and scores for a specific week

### Standings & Playoffs
- `get_regular_season_standings` - Returns the latest regular season standings for a league
- `get_playoff_results` - Get the playoff results - use this to determine final standings for a league
- `get_winners_bracket` - Get the winners bracket for league playoffs
- `get_losers_bracket` - Get the losers bracket for league playoffs

### Draft Information
- `get_user_drafts` - Get all drafts for a user in a specific sport and season
- `get_draft_picks` - Get all picks from a specific draft

### Player Data & Statistics
- `search_players` - Search for players by name with fuzzy matching
- `find_player_id` - Find a player's ID by name with confidence scoring
- `get_player_stats` - Get player statistics for a season, optionally grouped by week
- `get_player_projections` - Get player projections with formatted table display
- `get_player_news` - Get recent news articles for a player
- `get_player_ranks` - Get player rankings by PPR points for a season

### League-wide Analytics
- `get_trending_players` - Get players that are trending (being added/dropped) across leagues
- `get_weekly_projections` - Get all player projections for a specific week
- `get_enriched_players` - Get player data enriched with projections and rankings

### NFL State
- `get_nfl_state` - Get current NFL season state (week, season type, etc.)

## Usage Examples

### Basic League Information
```
Get information about league 12345
→ Uses get_league tool

Show me the rosters for league 12345
→ Uses get_league_rosters tool with player enrichment
```

### Player Data
```
Search for Josh Allen
→ Uses search_players tool

Get Josh Allen's stats for 2024
→ Uses get_player_stats tool

Show me Saquon Barkley's projections
→ Uses get_player_projections tool (returns formatted table)
```

### League Analysis
```
What are the standings for league 12345?
→ Uses get_regular_season_standings tool

Show me the playoff results for league 12345
→ Uses get_playoff_results tool
```

## Development

### Scripts
- `npm run dev` - Start local development server
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm run format` - Format code with Biome
- `npm run lint:fix` - Fix linting issues
- `npm run type-check` - Run TypeScript type checking

### Project Structure
```
src/
├── index.ts          # Main MCP server implementation
└── ...

package.json          # Dependencies and scripts
tsconfig.json         # TypeScript configuration
```
