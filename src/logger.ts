import winston from 'winston';
import * as dotenv from 'dotenv';
dotenv.config();

const { json, combine, timestamp, printf, colorize, align } = winston.format;

export default winston.createLogger({
  level: process.env.LOG_LEVEL || 'debug',
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize(),
        align(),
        printf(info => `[${info.level}]: ${info.message}`),
      ),
    }),
    new winston.transports.File({
      filename: 'patronum.log',
      format: combine(timestamp(), json()),
    }),
  ],
});
