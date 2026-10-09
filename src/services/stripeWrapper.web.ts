// Loaded on Web (Stubbed out to avoid native bundling errors)
export const useStripe = () => {
  return {
    initPaymentSheet: async () => ({
      error: { message: 'Stripe Payment Sheet is only supported on mobile devices.' },
    }),
    presentPaymentSheet: async () => ({
      error: { message: 'Stripe Payment Sheet is only supported on mobile devices.' },
    }),
  };
};

export const StripeProvider = ({ children }: { children: any }) => children;