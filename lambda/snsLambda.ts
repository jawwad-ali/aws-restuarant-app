import { Context } from "aws-lambda"
import { SNS, SES } from "aws-sdk"
import { PayloadType } from "./dynamoLambda"

const sns = new SNS()

export const handler = async (event: PayloadType, context: Context) => {
    console.log("before try block ", event.SnsMessage)
    console.log("event", event, "Topicc", process.env.SNS_TOPIC_ARN, "Messageee", event.SnsMessage);

    try {
        if (event.SnsMessage) {
            await sns.publish({
                TopicArn: process.env.SNS_TOPIC_ARN,
                Message: JSON.stringify(event.SnsMessage)
            }).promise()
        }
        console.log("IN THE TRY BLOCK", process.env.SNS_TOPIC_ARN, "MSG23", event.SnsMessage, 'message published');
    }
    catch (err) {
        console.log(err)
    }
    return { message: 'operation Successfull' }
}