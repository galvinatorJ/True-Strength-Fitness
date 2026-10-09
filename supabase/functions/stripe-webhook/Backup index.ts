import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const stripeTest = new Stripe(Deno.env.get('STRIPE_TEST_SECRET_KEY') as string, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});
const stripeLive = new Stripe(Deno.env.get('STRIPE_LIVE_SECRET_KEY') as string, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const testWebhookSecret = Deno.env.get('STRIPE_TEST_WEBHOOK_SECRET') as string;
const liveWebhookSecret = Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET') as string;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') as string,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string
);

Deno.serve(async (req: Request) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Webhook signature missing', { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event | null = null;

  try {
    event = await stripeTest.webhooks.constructEventAsync(body, signature, testWebhookSecret);
  } catch (_e) {
    try {
      event = await stripeLive.webhooks.constructEventAsync(body, signature, liveWebhookSecret);
    } catch (_e2) {
      console.error('Signature mismatch on both live and test secrets');
      return new Response('Webhook signature verification failed', { status: 400 });
    }
  }

  if (!event) {
    return new Response('Webhook signature verification failed', { status: 400 });
  }

  const activeStripe = event.livemode ? stripeLive : stripeTest;

  // 1. INITIAL CHECKOUT COMPLETED
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id;
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;
    const stripeEmail = session.customer_details?.email || null;

    if (userId && customerId) {
      let priceId: string | null = null;
      let planName = 'Gym Membership';
      const amountTotal = session.amount_total || 0;

      if (amountTotal === 3000) {
        planName = 'Pre-release (Promotion) - 12 Month Contract';
        priceId = 'price_1U1luD9nla8sR27v1b3SC1lG';
      } else if (amountTotal === 4000) {
        planName = 'Full Gym Use - 12 Month Contract';
        priceId = 'price_1TwL9F9nla8sR27vfPqFjnVm';
      } else if (amountTotal === 5000) {
        planName = 'Full Gym Use - Pay Monthly';
        priceId = 'price_1U1lzl9nla8sR27vjOZPWodX';
      }

      try {
        const lineItems = await activeStripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
        if (lineItems.data.length > 0) {
          const item = lineItems.data[0];
          if (item.price?.id) priceId = item.price.id;
          if (item.description && item.description !== 'Gym Membership') planName = item.description;
        }
      } catch (error) {
        console.error('Error fetching dynamic line items:', error);
      }

      let nextPaymentDate = new Date();
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);

      if (subscriptionId) {
        try {
          const subObj = await activeStripe.subscriptions.retrieve(subscriptionId);
          if (subObj.current_period_end) {
            nextPaymentDate = new Date(subObj.current_period_end * 1000);
          }

          const lowerName = planName.toLowerCase();
          const is12Month = lowerName.includes("12 month contract") || 
                            lowerName.includes("12-month contract") || 
                            lowerName.includes("pay monthly");

          if (is12Month) {
            const oneYearFromNow = new Date();
            oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
            const cancelAtTimestamp = Math.floor(oneYearFromNow.getTime() / 1000);

            await activeStripe.subscriptions.update(subscriptionId, {
              cancel_at: cancelAtTimestamp,
            });
            console.log(`Scheduled automatic cancellation in 1 year for plan: ${planName}`);
          }

        } catch (_e) {
          console.error('Error fetching or updating subscription details:', _e);
        }
      }

      await supabase.from('user_subscriptions').upsert({
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        stripe_price_id: priceId,
        plan_name: planName,
        status: 'active',
        next_payment_date: nextPaymentDate.toISOString(),
        updated_at: new Date().toISOString(),
        has_recovery_access: true,
        is_early_signup: true
      }, { onConflict: 'user_id' });

      await supabase.from('payment_logs').insert({
        user_id: userId,
        amount: amountTotal / 100,
        status: 'succeeded',
        plan_attempted: planName,
        plan_name: planName,
        stripe_email: stripeEmail
      });
    }
  }

  // --------------------------------------------------------------------------------
  // NEW CODE FOR THE APP BELOW
  // --------------------------------------------------------------------------------

  // 2. APP SUBSCRIPTION CREATED (Sets up the database row BEFORE payment clears)
  if (event.type === 'customer.subscription.created') {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;
    const subscriptionId = subscription.id;
    
    // We strictly only process this if it came from the app (using the metadata we attached)
    const userId = subscription.metadata?.supabase_user_id;
    
    if (userId && customerId) {
      const priceId = subscription.items.data[0]?.price.id;
      let planName = 'In-App Gym Membership';
      
      // Update these to match whatever price IDs your APP is using (Sandbox or Live)
      if (priceId === 'price_1U1luD9nla8sR27v1b3SC1lG') planName = 'Pre-release (Promotion) - 12 Month Contract';
      else if (priceId === 'price_1TwL9F9nla8sR27vfPqFjnVm') planName = 'Full Gym Use - 12 Month Contract';
      else if (priceId === 'price_1U1lzl9nla8sR27vjOZPWodX') planName = 'Full Gym Use - Pay Monthly';

      let nextPaymentDate = new Date();
      if (subscription.current_period_end) {
        nextPaymentDate = new Date(subscription.current_period_end * 1000);
      }

      await supabase.from('user_subscriptions').upsert({
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        stripe_price_id: priceId,
        plan_name: planName,
        status: subscription.status, // This will be 'incomplete' initially
        next_payment_date: nextPaymentDate.toISOString(),
        updated_at: new Date().toISOString(),
        has_recovery_access: true,
        is_early_signup: true
      }, { onConflict: 'user_id' });
    }
  }

// --------------------------------------------------------------------------------
  // UNIFIED PAYMENT SUCCEEDED (Handles App Initial Payments & All Future Renewals)
  // --------------------------------------------------------------------------------
  if (event.type === 'invoice.payment_succeeded') {
    console.log('--- RECEIVED INVOICE.PAYMENT_SUCCEEDED ---');
    const invoice = event.data.object as Stripe.Invoice;
    const subscriptionId = invoice.subscription as string;
    const customerId = invoice.customer as string;
    const amountPaid = invoice.amount_paid / 100;
    const stripeEmail = invoice.customer_email || null;

    console.log(`Processing Customer: ${customerId} | Subscription: ${subscriptionId}`);

    if (subscriptionId && customerId) {
      try {
        const subscription = await activeStripe.subscriptions.retrieve(subscriptionId);
        
        console.log('Checking database for existing customer...');
        const { data: userData, error: dbQueryError } = await supabase
          .from('user_subscriptions')
          .select('user_id, plan_name')
          .eq('stripe_customer_id', customerId)
          .maybeSingle();

        if (dbQueryError) console.error("Database query error:", dbQueryError);

        const userId = userData?.user_id || subscription.metadata?.supabase_user_id;
        console.log(`Resolved User ID: ${userId || 'NONE FOUND'}`);

        let planName = userData?.plan_name;
        
        if (!planName) {
          const priceId = subscription.items.data[0]?.price.id;
          if (priceId === 'price_1U1luD9nla8sR27v1b3SC1lG') planName = 'Pre-release (Promotion) - 12 Month Contract';
          else if (priceId === 'price_1TwL9F9nla8sR27vfPqFjnVm') planName = 'Full Gym Use - 12 Month Contract';
          else if (priceId === 'price_1U1lzl9nla8sR27vjOZPWodX') planName = 'Full Gym Use - Pay Monthly';
          else planName = subscription.metadata?.plan_type || 'In-App Gym Membership';
        }

        if (userId) {
          const nextPaymentDate = subscription.current_period_end 
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

          console.log('Updating user_subscriptions status to active...');
          const { error: updateError } = await supabase.from('user_subscriptions').update({
            status: 'active',
            next_payment_date: nextPaymentDate,
            updated_at: new Date().toISOString()
          }).eq('user_id', userId);

          if (updateError) console.error("User Sub Update Error:", updateError);

          console.log('Inserting into payment_logs...');
          const { error: insertError } = await supabase.from('payment_logs').insert({
            user_id: userId,
            amount: amountPaid,
            status: 'succeeded',
            plan_attempted: planName,
            plan_name: planName,
            stripe_email: stripeEmail
          });

          if (insertError) {
            console.error("PAYMENT LOG INSERT ERROR:", insertError);
          } else {
            console.log(`SUCCESS: Payment logged for user ${userId}`);
          }
        } else {
           console.error(`FAILURE: Could not find a User ID in the database OR in the Stripe metadata for Customer ${customerId}`);
        }
      } catch (error) {
        console.error('Error processing payment success:', error);
      }
    }
  }

  // 3. PAYMENT FAILED OR SUBSCRIPTION DELETED
  if (event.type === 'invoice.payment_failed' || event.type === 'customer.subscription.deleted') {
    const obj = event.data.object as any;
    const customerId = obj.customer as string;

    if (customerId) {
      const isDeleted = event.type === 'customer.subscription.deleted';

      await supabase
        .from('user_subscriptions')
        .update({
          status: isDeleted ? 'canceled' : 'past_due',
          cancel_at_period_end: false,
          updated_at: new Date().toISOString()
        })
        .eq('stripe_customer_id', customerId);
    }
  }

  // 4. SUBSCRIPTION UPDATED (Catches Period Extension, Resumes, Status Shifts)
  if (event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription;
    const customerId = subscription.customer as string;

    if (customerId) {
      const nextPaymentDate = subscription.current_period_end 
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null;

      let updatedStatus = subscription.status as string;
      if (subscription.cancel_at_period_end) {
        updatedStatus = 'cancellation_requested';
      }

      const updateData: Record<string, any> = { 
        cancel_at_period_end: subscription.cancel_at_period_end,
        status: updatedStatus,
        updated_at: new Date().toISOString()
      };

      if (nextPaymentDate) {
        updateData.next_payment_date = nextPaymentDate;
      }

      await supabase
        .from('user_subscriptions')
        .update(updateData)
        .eq('stripe_customer_id', customerId);
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});