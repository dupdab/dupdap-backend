import { context, trace } from "@opentelemetry/api";
import { format } from "winston";
import {
  runWithCorrelationId,
  getCorrelationId,
} from "./correlation-id.context";
import { requestContextFormat } from "./request-context.format";
import { CorrelationIdMiddleware } from "./middleware/correlation-id.middleware";

describe("request logging context", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([undefined, "checkout-123", "bad id", "x".repeat(129)])(
    "returns a safe ID for header %s",
    (header) => {
      const req = { headers: { "x-request-id": header } } as any;
      const res = { setHeader: jest.fn() } as any;
      new CorrelationIdMiddleware().use(req, res, () => {
        expect(getCorrelationId()).toBe(req.requestId);
      });
      expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.requestId);
      expect(res.setHeader).toHaveBeenCalledWith(
        "X-Correlation-ID",
        req.requestId,
      );
      expect(req.requestId).toMatch(/^[a-zA-Z0-9._:-]+$/);
      if (header === "checkout-123") expect(req.requestId).toBe(header);
    },
  );

  it("keeps concurrent asynchronous requests isolated", async () => {
    await Promise.all(
      ["one", "two"].map((id) =>
        runWithCorrelationId(id, async () => {
          await new Promise((resolve) => setImmediate(resolve));
          const info = requestContextFormat().transform(
            { level: "info", message: "service log" },
            {},
          ) as any;
          expect(info.requestId).toBe(id);
        }),
      ),
    );
    expect(getCorrelationId()).toBeUndefined();
  });

  it("serializes the active OpenTelemetry trace and request as JSON", () => {
    jest
      .spyOn(trace, "getSpan")
      .mockReturnValue({
        spanContext: () => ({ traceId: "abc", spanId: "def" }),
      } as any);
    runWithCorrelationId("checkout", () => {
      const output = format
        .combine(requestContextFormat(), format.json())
        .transform({ level: "info", message: "paid" }, {}) as any;
      expect(JSON.parse(output[Symbol.for("message")])).toMatchObject({
        requestId: "checkout",
        traceId: "abc",
        spanId: "def",
      });
      expect(trace.getSpan).toHaveBeenCalledWith(context.active());
    });
  });
});
