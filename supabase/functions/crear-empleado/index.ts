// Service-role credentials remain exclusively in the server.
// Local patch only: deploying this function requires separate authorization.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createEmployeeHandler } from './handler.ts'

Deno.serve(createEmployeeHandler({ createClient, env: key => Deno.env.get(key) }))
