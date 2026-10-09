import { createClient } from "@supabase/supabase-js";
import { serve } from "serve";
import Stripe from "stripe";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let isTestMode = true;
    try {
      const body = await req.json();
      if (typeof body.isTestMode === 'boolean') {
        isTestMode = body.isTestMode;
      }
    } catch (_e) {
      // Default to test mode if body is unparseable
    }

    // 1. Authenticate user
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Check for service role key
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("SERVICE_ROLE_KEY");

    if (!serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing in Edge Function secrets.");
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // 3. Fetch user's subscription and plan name
    const { data: subData } = await supabaseAdmin
      .from("user_subscriptions")
      .select("stripe_subscription_id, plan_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subData?.stripe_subscription_id) {
      const planName = subData.plan_name || "";
      const is12MonthContract = planName.toLowerCase().includes("12 month contract");

      console.log(`Plan: "${planName}". Is 12-Month Contract? ${is12MonthContract}`);

      // Only cancel in Stripe if NOT a 12-Month Contract
      if (!is12MonthContract) {
        // Fallback to STRIPE_SECRET_KEY if specific test/live keys are not set
        const stripeKey = isTestMode
          ? (Deno.env.get("STRIPE_TEST_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY"))
          : (Deno.env.get("STRIPE_LIVE_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY"));

        if (stripeKey) {
          const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
          try {
            console.log(`Attempting to cancel Stripe subscription: ${subData.stripe_subscription_id}`);
            await stripe.subscriptions.cancel(subData.stripe_subscription_id);
            console.log("Successfully canceled Stripe subscription.");
          } catch (stripeErr: any) {
            // Changed from warn to error so it highlights in Supabase logs
            console.error("STRIPE CANCELLATION ERROR:", stripeErr?.message || stripeErr);
          }
        } else {
          console.error(`Missing Stripe key in Edge Function secrets! (isTestMode: ${isTestMode})`);
        }
      } else {
        console.log("Skipping Stripe cancellation (12-month contract detected).");
      }
    } else {
      console.log("No Stripe subscription ID found for this user.");
    }

    // 4. Permanently delete the subscription row
    await supabaseAdmin
      .from("user_subscriptions")
      .delete()
      .eq("user_id", user.id);

    // 5. Delete profile data
    await supabaseAdmin.from("profiles").delete().eq("id", user.id);

    // 6. Permanently delete user from Supabase Auth
    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      console.error("Error deleting auth user:", deleteUserError);
      throw deleteUserError;
    }

    return new Response(
      JSON.stringify({ success: true, message: "Account deleted successfully." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Delete account error:", err);
    return new Response(
      JSON.stringify({ error: err?.message || "An unexpected error occurred during account deletion." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});