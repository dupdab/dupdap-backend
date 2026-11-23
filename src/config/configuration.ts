export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  webhooks: {
    maxEndpointsPerMerchant: parseInt(
      process.env.WEBHOOK_MAX_ENDPOINTS_PER_MERCHANT ?? '10',
      10,
    ),
  },
});
