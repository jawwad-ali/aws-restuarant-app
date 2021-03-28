import * as cdk from '@aws-cdk/core';
import * as appsync from '@aws-cdk/aws-appsync';
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as events from '@aws-cdk/aws-events';
import * as eventsTargets from '@aws-cdk/aws-events-targets';
import * as lambda from '@aws-cdk/aws-lambda';
import * as sns from '@aws-cdk/aws-sns';
import * as iam from '@aws-cdk/aws-iam';
import * as snsSubscriptions from '@aws-cdk/aws-sns-subscriptions';
import * as stepFunctions from '@aws-cdk/aws-stepfunctions';
import * as stepFunctionsTasks from '@aws-cdk/aws-stepfunctions-tasks';
import * as cognito from "@aws-cdk/aws-cognito"
import { EVENT_SOURCE, requestTemplate, responseTemplate } from '../appsync-request-response';
import { Rule } from '@aws-cdk/aws-events';

export class RestuarantAppStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    //////////////////////// creating User Pool /////////////////////////////////
    const userPool = new cognito.UserPool(this, "userPool-Amplify", {
      selfSignUpEnabled: true,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      autoVerify: { email: true, },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        phoneNumber: {
          required: true,
          mutable: true
        }
      },
    })
    const userPoolClient = new cognito.UserPoolClient(this, "userPoolClient-Amplify", {
      userPool,
    })

    new cognito.CfnUserPoolGroup(this, "AdminsGroup", {
      groupName: 'admins',
      userPoolId: userPool.userPoolId,
    });

    // GQL API
    const api = new appsync.GraphqlApi(this, "restuarantAPI", {
      name: "restuarantAPI",
      schema: appsync.Schema.fromAsset('schema/schema.gql'),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.API_KEY
        }
      },
      logConfig: { fieldLogLevel: appsync.FieldLogLevel.ALL },
      xrayEnabled: true
    });

    // Create table
    const resutuarantTable = new dynamodb.Table(this, "restuaratnTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: {
        name: "id",
        type: dynamodb.AttributeType.STRING
      }
    });

    // DATA SOURCES
    // Dyanmodb as data source
    const restuarantTimeSlotDS = api.addDynamoDbDataSource("restuarantDS", resutuarantTable)

    // http as DS
    const httpASDS = api.addHttpDataSource(
      "ds",
      "https://events." + this.region + ".amazonaws.com/", // This is the ENDPOINT for eventbridge.
      {
        name: "retuarantDS",
        description: "From Appsync to Eventbridge",
        authorizationConfig: {
          signingRegion: this.region,
          signingServiceName: "events",
        },
      }
    )
    events.EventBus.grantAllPutEvents(httpASDS)

    // APPSYNC RESOLVERS
    restuarantTimeSlotDS.createResolver({
      typeName: "Query",
      fieldName: "getTimeSlots",
      requestMappingTemplate: appsync.MappingTemplate.dynamoDbScanTable(),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem()
    })

    const mutations = ["addTimeSlot", "deleteTimeSlot", "bookTimeSlot", "addBookingRequest", "deleteBookingRequest", "cancelBooking", "resetAllBookings"]

    mutations.forEach((mut) => {
      let details = `\\\"id\\\": \\\"$ctx.args.id\\\"`;

      if (mut === 'addTimeSlot') {
        details = `\\\"from\\\":\\\"$ctx.args.timeSlot.from\\\", \\\"to\\\":\\\"$ctx.args.timeSlot.to\\\"`

      } else if (mut === "addBookingRequest") {
        details = `\\\"id\\\":\\\"$ctx.args.id\\\", \\\"userName\\\":\\\"$ctx.args.userName\\\"`
      }

      httpASDS.createResolver({
        typeName: "Mutation",
        fieldName: mut,
        requestMappingTemplate: appsync.MappingTemplate.fromString(requestTemplate(details, mut)),
        responseMappingTemplate: appsync.MappingTemplate.fromString(responseTemplate())
      })
    })

    // DynamodbLambda
    const dynamoLambda = new lambda.Function(this, "restuarantDynamo", {
      functionName: "RestuarantLambda",
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset("lambda"),
      handler: "dynamoLambda.handler",
      environment: {
        DYNAMO_TABLE_NAME: resutuarantTable.tableName
      },
    })
    resutuarantTable.grantReadWriteData(dynamoLambda)

    // RULE
    const rule = new Rule(this, "theRule", {
      ruleName: "lambdaInvokeRule",
      eventPattern: {
        source: ["restaurant-app-events"],
      },
    });
    rule.addTarget(new eventsTargets.LambdaFunction(dynamoLambda));

  }
}
