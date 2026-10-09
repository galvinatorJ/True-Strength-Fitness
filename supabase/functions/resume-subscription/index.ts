import { createClient } from 'npm:@supabase/supabase-js@^2.45.0';
import Stripe from "stripe";

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error('Unauthorized user session');

    const reqBody = await req.json();
    const action = reqBody?.action;

    const { data: sub, error: subError } = await supabaseClient
      .from('user_subscriptions')
      .select('stripe_subscription_id, stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (subError || !sub) {
      throw new Error('No active subscription found.');
    }

    // ACTION 1: Generate Native In-App Payment Sheet Data for Past Due Sub
    // NOTE: Strictly generates payment sheet keys. Does NOT touch next_payment_date.
    if (action === 'update_payment') {
      if (!sub.stripe_customer_id || !sub.stripe_subscription_id) {
        throw new Error('Missing Stripe customer or subscription ID.');
      }
      
      // NEW LOGIC: Instruct Stripe to automatically save the new card as the default 
      // for this subscription as soon as the past-due invoice is paid successfully.
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        payment_settings: {
          save_default_payment_method: 'on_subscription',
        },
      });

      const stripeSub = await stripe.subscriptions.retrieve(
        sub.stripe_subscription_id,
        { expand: ['latest_invoice.payment_intent'] }
      );

      const latestInvoice: any = stripeSub.latest_invoice;

      if (!latestInvoice || latestInvoice.status !== 'open') {
        throw new Error('No open invoice found. Your membership might not be past due.');
      }

      const paymentIntent = latestInvoice.payment_intent;

      if (!paymentIntent || !paymentIntent.client_secret) {
        throw new Error('Could not retrieve secure payment details for this invoice.');
      }

      // NEW LOGIC: Ensure the payment intent is configured to attach the card to the customer for future off-session usage
      await stripe.paymentIntents.update(paymentIntent.id, {
        setup_future_usage: 'off_session',
      });

      const ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: sub.stripe_customer_id },
        { apiVersion: '2023-10-16' }
      );

      return new Response(
        JSON.stringify({ 
          success: true, 
          paymentIntentClientSecret: paymentIntent.client_secret,
          ephemeralKeySecret: ephemeralKey.secret,
          customerId: sub.stripe_customer_id
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }
    
    // ACTION 2: Undo Scheduled Cancellation
    // NOTE: Clears pending cancellation flags in Stripe and Supabase. 
    // Omits next_payment_date entirely to preserve 12-month contract timelines.
    if (action === 'resume_cancelled') {
      if (!sub.stripe_subscription_id) throw new Error('No Stripe subscription ID found.');
      
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: false,
      });

      await supabaseClient
        .from('user_subscriptions')
        .update({
          status: 'active',
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      return new Response(
        JSON.stringify({ success: true, message: 'Membership resumed successfully' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    throw new Error('Invalid action provided');

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});