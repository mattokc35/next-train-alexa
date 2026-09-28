#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NextTrainStack } from '../lib/next-train-stack';

const app = new cdk.App();

new NextTrainStack(app, 'NextTrainAlexaStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
  description: 'Lambda backend for the Next Train Alexa skill (PATH + MTA real-time arrivals).',
});
