import winston from 'winston';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const devFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${level}]: ${stack || message}${metaStr}`;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
  ),
  defaultMeta: { service: 'dgmarq-api' },
  transports: [
    // Console transport — pretty in dev, JSON in prod
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? json()
        : combine(colorize(), devFormat),
    }),
    // File transports — only in production or when LOG_TO_FILE is set
    ...(process.env.NODE_ENV === 'production' || process.env.LOG_TO_FILE
      ? [
          new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 5,
            format: json(),
          }),
          new winston.transports.File({
            filename: 'logs/combined.log',
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5,
            format: json(),
          }),
        ]
      : []),
  ],
});

// Convenience aliases for backward compatibility
logger.success = (message, ...args) => logger.info(message, ...args);
logger.http = (method, url, statusCode = null, ...args) => {
  const status = statusCode ? `[${statusCode}]` : '';
  logger.info(`${method} ${url} ${status}`, ...args);
};

export { logger };
export default logger;
