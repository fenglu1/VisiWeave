import { copyableLogValue, formatLogValue, previewLogValue } from "../features/request-logs/request-log-display";

const logValue = {
  prompt: "A".repeat(260),
  request: {
    model: "openai/gpt-image-2",
    size: "3840x2160"
  }
};

const expanded = formatLogValue(logValue);
const preview = previewLogValue(logValue, 120);

expect(expanded.includes('"openai/gpt-image-2"'), "expanded log formatting keeps nested JSON values");
expect(expanded.length > preview.length, "collapsed preview is shorter than the expanded value");
expect(preview.includes("[TRUNCATED"), "collapsed preview marks truncated values");
expect(copyableLogValue(logValue) === expanded, "copy action uses the full expanded value");

console.log("request logs page smoke checks passed");

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
