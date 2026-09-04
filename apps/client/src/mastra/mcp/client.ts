import { MCPClient } from '@mastra/mcp'

export const mcpClient = new MCPClient({
  id: 'my-mcp-client',
  servers: {
    wikipedia: {
      command: 'npx',
      args: ['-y', 'wikipedia-mcp'],
    },
    weather: {
      url: new URL('https://weather.example.com/mcp'),
      requestInit: {
        headers: {
          Authorization: `Bearer ${process.env.WEATHER_API_KEY}`,
        },
      },
    },
  },
})