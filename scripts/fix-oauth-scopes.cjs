const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.production.local' });

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const rows = await sql`SELECT client_id, client_name, scopes FROM oauth_clients WHERE client_id = 'doc_EsQof0MAhthdF60D'`;
  console.log('Current client:', JSON.stringify(rows, null, 2));

  const updated = await sql`
    UPDATE oauth_clients 
    SET scopes = ARRAY['openid', 'email', 'mcp', 'treasury:read']
    WHERE client_id = 'doc_EsQof0MAhthdF60D'
    RETURNING client_id, client_name, scopes
  `;
  console.log('Updated:', JSON.stringify(updated, null, 2));
}

main().catch(console.error);
