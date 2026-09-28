import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as logs from 'aws-cdk-lib/aws-logs';
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
 * Defines the Lambda function backing the Next Train Alexa skill, its
 * execution role, and the resource policy that allows the Alexa Skills Kit
 * service to invoke it. The MTA API key is read from an SSM SecureString
 * parameter at deploy time and injected as a Lambda environment variable —
 * see README.md for how to create that parameter.
 */
export class NextTrainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: NextTrainStackProps = {}) {
    super(scope, id, props);

    const alexaSkillId =
      props.alexaSkillId ?? (this.node.tryGetContext('alexaSkillId') as string | undefined);

    const mtaApiKeyParam = ssm.StringParameter.valueForStringParameter(
      this,
      '/next-train/mta-api-key',
    );

    const fn = new lambda.Function(this, 'NextTrainFunction', {
      functionName: 'next-train-alexa-skill',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'lambda/index.handler',
      code: lambda.Code.fromAsset('../dist'),
      timeout: cdk.Duration.seconds(8),
      memorySize: 256,
      environment: {
        MTA_API_KEY: mtaApiKeyParam,
      },
      logRetention: logs.RetentionDays.TWO_WEEKS,
    });

    // Scope the execution role down to just CloudWatch Logs (the CDK-managed
    // basic execution role already grants this) — no additional AWS
    // permissions are required since both upstream APIs are called over
    // plain HTTPS from within the function.
    fn.role?.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: 'next-train/mta-api-key',
          }),
        ],
      }),
    );

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
