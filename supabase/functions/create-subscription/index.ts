import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const stripeTest = new Stripe(Deno.env.get('STRIPE_TEST_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});
const stripeLive = new Stripe(Deno.env.get('STRIPE_LIVE_SECRET_KEY') ?? '', {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
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
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }

    // 1. Verify user with auth header securely
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // 2. Initialize Admin client to bypass RLS for secure Database inserts
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 👇 ADDED passDate to the destructured request body
    const { priceId, planType, passDate, mode = 'test' } = await req.json();
    const activeStripe = mode === 'live' ? stripeLive : stripeTest;

    const { data: subRecord } = await supabaseAdmin
      .from('user_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    let customerId = subRecord?.stripe_customer_id;

    if (!customerId) {
      const customer = await activeStripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      const { error: dbError } = await supabaseAdmin
        .from('user_subscriptions')
        .upsert({
          user_id: user.id,
          stripe_customer_id: customerId,
          status: 'inactive',
          has_recovery_access: true,
        },
        { onConflict: 'user_id' }
        );
        
      if (dbError) throw new Error(`Database Error: ${dbError.message}`);
    }

    const ephemeralKey = await activeStripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: '2023-10-16' }
    );
    
    let paymentIntentClientSecret: string | null = null;
    let setupIntentClientSecret: string | null = null;
    let subscriptionId: string | null = null;

    // 👇 FIXED: MATCHES FRONTEND 'daypass' INSTEAD OF 'day'
    if (planType === 'daypass') {
      const paymentIntent = await activeStripe.paymentIntents.create({
        amount: 1500, // £15.00
        currency: 'gbp',
        customer: customerId,
        payment_method_types: ['card', 'klarna', 'link'],
        metadata: { 
          supabase_user_id: user.id, 
          plan_type: planType,
          pass_date: passDate // 👇 Attaches date to Stripe for your webhook!
        },
      });
      paymentIntentClientSecret = paymentIntent.client_secret;
    } else {
      // EXISTING MONTHLY LOGIC - UNTOUCHED
      const is12MonthContract = 
        priceId === 'price_1U1luD9nla8sR27v1b3SC1lG' || 
        priceId === 'price_1TwL9F9nla8sR27vfPqFjnVm';

      let cancelAtTimestamp = undefined;
      if (is12MonthContract) {
        const oneYearFromNow = new Date();
        oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
        cancelAtTimestamp = Math.floor(oneYearFromNow.getTime() / 1000);
      }

      const subscription = await activeStripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        cancel_at: cancelAtTimestamp,
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card', 'bacs_debit'],
        },
        expand: ['latest_invoice.payment_intent', 'pending_setup_intent'],
        metadata: { supabase_user_id: user.id, plan_type: planType },
      });

      subscriptionId = subscription.id;

      if (subscription.pending_setup_intent) {
        const setupIntent = subscription.pending_setup_intent as Stripe.SetupIntent;
        setupIntentClientSecret = setupIntent.client_secret;
      } else {
        const invoice = subscription.latest_invoice as Stripe.Invoice;
        if (invoice && invoice.payment_intent) {
          const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent;
          paymentIntentClientSecret = paymentIntent.client_secret;
        }
      }
    }

    return new Response(
      JSON.stringify({
        paymentIntentClientSecret,
        setupIntentClientSecret, 
        ephemeralKey: ephemeralKey.secret,
        customerId: customerId,
        subscriptionId: subscriptionId,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});