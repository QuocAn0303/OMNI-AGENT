/**
 * utils/logger.js — Winston logger cho toàn bộ backend
 * 
 * Tổng quan:
 * - Ghi log ra console (colorized) + file (error.log, combined.log)
 * - Format: timestamp + JSON (dễ parse)
 * - Level: config qua LOG_LEVEL env (mặc định "info")
 * - File log được lưu trong thư mục logs/
 */

const { createLogger, transports, format } = require("winston");
const path = require("path");

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.splat(),
    format.json(),
  ),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple()),
    }),
    new transports.File({
      filename: path.join("logs", "error.log"),
      level: "error",
    }),
    new transports.File({ filename: path.join("logs", "combined.log") }),
  ],
});

module.exports = logger;
