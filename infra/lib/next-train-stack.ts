import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface NextTrainStackProps extends cdk.StackProps {
  /**
   * Optional Alexa Skill ID used to restrict which skill is allowed to
   * invoke this Lambda (recommended). If omitted, no skill-id restriction
   * is applied (any Alexa skill in your account boundary could invoke it).
   * Pass via `-c alexaSkillId=amzn1.ask.skill....` or set below.
   */
  alexaSkillId?: string;
}

/**
 * Defines the Lambda function backing the Next Train Alexa skill and the
 * resource policy that allows the Alexa Skills Kit service to invoke it.
 *
 * The function bundles `puppeteer-core` and `@sparticuz/chromium` — a
 * Lambda-compatible headless Chromium build — used to scrape PATH's
 * official ridepath.json feed past its Akamai bot-check (see
 * src/services/pathService.ts). Memory and timeout are sized generously
 * (2048 MB / 20s) to accommodate launching a real browser per cold start.
 */
export class NextTrainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: NextTrainStackProps = {}) {
    super(scope, id, props);

    const alexaSkillId =
      props.alexaSkillId ?? (this.node.tryGetContext('alexaSkillId') as string | undefined);

    // Stores each user's saved "home base" station (see SetHomeStationIntent)
    // via ask-sdk-dynamodb-persistence-adapter, keyed by Alexa userId.
    const homeStationTable = new dynamodb.Table(this, 'HomeStationTable', {
      tableName: 'next-train-alexa-home-stations',
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fn = new NodejsFunction(this, 'NextTrainFunction', {
      functionName: 'next-train-alexa-skill',
      entry: path.join(__dirname, '../../src/lambda/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      // @sparticuz/chromium only ships x64 binaries via npm (arm64 requires
      // a separately-hosted pack file — see its README), so pin the
      // architecture explicitly rather than relying on the account default.
      architecture: lambda.Architecture.X86_64,
      timeout: cdk.Duration.seconds(20),
      memorySize: 2048,
      logRetention: logs.RetentionDays.TWO_WEEKS,
      environment: {
        HOME_STATION_TABLE_NAME: homeStationTable.tableName,
      },
      bundling: {
        // puppeteer-core and @sparticuz/chromium ship native/binary assets
        // and rely on relative path resolution to find them — both must be
        // excluded from esbuild's bundle and instead installed as real
        // node_modules alongside the bundled handler code.
        nodeModules: ['puppeteer-core', '@sparticuz/chromium'],
        minify: true,
        sourceMap: true,
      },
    });

    homeStationTable.grantReadWriteData(fn);

    fn.addPermission('AlexaSkillInvokePermission', {
      principal: new iam.ServicePrincipal('alexa-appkit.amazon.com'),
      eventSourceToken: alexaSkillId,
      action: 'lambda:InvokeFunction',
    });

    new cdk.CfnOutput(this, 'FunctionArn', {
      value: fn.functionArn,
      description:
        'Use this ARN as the endpoint for the custom skill in the Alexa Developer Console.',
    });
  }
}
