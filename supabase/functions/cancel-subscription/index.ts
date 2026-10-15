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

    let isTestMode = false;
    let action = 'cancel_at_period_end';

    try {
      const body = await req.json();
      if (typeof body.isTestMode === 'boolean') isTestMode = body.isTestMode;
      if (body.action) action = body.action;
    } catch (_e) { // Fallback to default options if body parsing fails or is empty 
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: subData, error: subError } = await supabaseClient
      .from("user_subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subError || !subData?.stripe_subscription_id) {
      return new Response(
        JSON.stringify({ error: "No active Stripe subscription found for this user." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripeKey = isTestMode 
      ? Deno.env.get("STRIPE_TEST_SECRET_KEY") 
      : Deno.env.get("STRIPE_LIVE_SECRET_KEY");

    if (!stripeKey) throw new Error(`Stripe ${isTestMode ? 'Test' : 'Live'} Secret Key is missing`);

    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // 1. Retrieve the subscription from Stripe
    const sub = await stripe.subscriptions.retrieve(subData.stripe_subscription_id);

    // 2. If Stripe attached a schedule, release it first so we can modify cancellation directly
    if (sub.schedule) {
      await stripe.subscriptionSchedules.release(sub.schedule as string);
    }

    // 3. Perform Stripe Action
    const updatedSub = await stripe.subscriptions.update(subData.stripe_subscription_id, {
      cancel_at_period_end: action !== 'resume',
    });

    const nextPaymentDate = updatedSub.current_period_end 
      ? new Date(updatedSub.current_period_end * 1000).toISOString()
      : undefined;

    const newStatus = action === 'resume' ? 'active' : 'cancellation_requested';

    await supabaseClient
      .from("user_subscriptions")
      .update({ 
        status: newStatus,
        cancel_at_period_end: action !== 'resume',
        ...(nextPaymentDate && { next_payment_date: nextPaymentDate }),
        updated_at: new Date().toISOString()
      })
      .eq("user_id", user.id);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: action === 'resume' ? "Membership successfully resumed." : "Subscription set to cancel at period end.",
        next_payment_date: nextPaymentDate
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("Manage subscription error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});