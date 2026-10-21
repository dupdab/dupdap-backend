import { context, trace } from "@opentelemetry/api";
import { format } from "winston";
import { getCorrelationId } from "./correlation-id.context";

/** Applied before JSON serialization on every transport, including service logs. */
export const requestContextFormat = format((info) => {
  const requestId = getCorrelationId();
  if (requestId) {
    info.requestId = requestId;
    info.correlationId = requestId;
  }
  const span = trace.getSpan(context.active())?.spanContext();
  if (span) {
    info.traceId = span.traceId;
    info.spanId = span.spanId;
  }
  return info;
});
