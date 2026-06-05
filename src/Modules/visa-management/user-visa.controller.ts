
import { Request, Response } from "express";
import { hubtelDirectMoneyReceive, prisma } from "../../config/index.js";
import { HUBTEL_CANCELLATION_URL, HUBTEL_RETURN_URL, PaymentController } from "../payment-management/payment.controller.js";
import { PaymentStatus, PaymentTargetType, VisaApprovalStatus, VisaOnArrivalData, VisaRequestStatus } from "@prisma/client";
import { InitiateVisaPaymentSchema, VisaOnArrivalDataSchema } from "src/validator/visaValidation.js";
import { convertUSDToGHS } from "src/helpers/stringHelper.js";
import sendEmail from "src/config/resend.config.js";


export class UserVisaController {

async createVisaRequest(req:Request, res:Response) {
  try {

    const userId = req.user?.id as string;
    //check if user exists
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });
    if (!user) {
        return res.status(404).json({ message: "User not found" });
    }
    const  applicantData  = req.body as VisaOnArrivalDataSchema;


    // Create Visa Request
    const visaRequest = await prisma.visaOnArrivalRequest.create({
      data: {
        userId,
        status: "PENDING",
      },
    });

    // Attach applicant data
    await prisma.visaOnArrivalData.create({
      data: {
        ...applicantData,
        requestId: visaRequest.id,
      },
    });

    res.status(201).json({ visaRequest });
  } catch (err) {
    console.log("failed to create visa request ", err)
    res.status(400).json({ error: "failed to create visa request" });
  }
}

// Step 2: Initiate payment for existing request
async initiateVisaPayment(req:Request, res:Response) {
  try {
    const {requestId} = req.params ;
    const {  packageType } = req.body;

    // Fetch existing request
    const visaRequest = await prisma.visaOnArrivalRequest.findUnique({
      where: { id: requestId as string },
      include: { visaData: true },
    });

    if (!visaRequest) {
      return res.status(404).json({ error: "Visa request not found" });
    }

    // Calculate fees
    let totalAmount = 0;
    if (packageType === "STANDARD") {
      const statutoryFeeGHS = await convertUSDToGHS(200);
      totalAmount = 464 + statutoryFeeGHS;
    } else if (packageType === "EXPEDITED") {
      totalAmount = 1450;
    }

    // Trigger payment
    const payment = await PaymentController.initializePayment({
      userId: visaRequest.userId,
      targetType: PaymentTargetType.VISA_ON_ARRIVAL,
      targetId: visaRequest.id,
      totalAmount: totalAmount,
      currency: "GHS",
      description: `Visa on Arrival - ${packageType}`,
      callbackUrl: `${process.env.API_URL}/visa/payment-callback`,
      returnUrl: HUBTEL_RETURN_URL || "",
      cancellationUrl: HUBTEL_CANCELLATION_URL
    });

    // Update request with paymentId
    await prisma.visaOnArrivalRequest.update({
      where: { id: requestId as string},
      data: { paymentId: payment.paymentId, packageType },
    });

    res.json({ visaRequest, payment });
  } catch (err) {
    console.log("failed to initiate visa payment ", err)
    res.status(400).json({ error: "failed to initiate visa payment " });
  }
}


async handleVisaPaymentCallback(req:Request, res:Response) {

  try{
       const payload = req.body;

    // 1. Validate payload
    // (You can build a Zod schema for ResponseCode, Status, Data)

    const { ResponseCode, Status, Data } = payload;

    // 2. Find payment by ClientReference
    const payment = await prisma.payment.findUnique({
      where: { reference: Data.ClientReference },
    });
  if (!payment) return res.status(404).json({ error: "Payment not found" });


//   const { paymentId, status, packageType } = req.body;

    const visaRequest = await prisma.visaOnArrivalRequest.findUnique({
      where: { paymentId: payment.id },
      select: { packageType: true },
    });

    if (!visaRequest) {
      return res.status(404).json({ error: "Visa request not found" });
    }


  if (Status === "SUCCESS") {
    if (visaRequest.packageType === "STANDARD") {
      // Ledger Split
      await prisma.ledgerTransaction.createMany({
        data: [
          {
            accountId: await UserVisaController.getAccountId("Account_DAGh_Revenue"),
            paymentId: payment.id,
            amount: 464,
            currency: "GHS",
            type: "CREDIT",
            description: "Visa Facilitation Fee",
          },
          {
            accountId: await UserVisaController.getAccountId("Account_GIS_Statutory_Reserve"),
            paymentId:payment.id,
            amount: await convertUSDToGHS(200),
            currency: "GHS",
            type: "CREDIT",
            description: "Statutory GIS Fee Reserve",
          },
        ],
      });

      await prisma.visaOnArrivalRequest.update({
        where: { paymentId: payment.id },
        data: { status: "READY_FOR_GIS_SUBMISSION" },
      });
    }

    if (visaRequest.packageType === "EXPEDITED") {
      await prisma.ledgerTransaction.create({
        data: {
          accountId: await UserVisaController.getAccountId("Account_DAGh_Revenue"),
          paymentId:payment.id,
          amount: 1450,
          currency: "GHS",
          type: "CREDIT",
          description: "Expedited Visa Facilitation Fee",
        },
      });

      await prisma.visaOnArrivalRequest.update({
        where: { paymentId:payment.id },
        data: { status: "EXPEDITED_AIRPORT_PAYMENT_PENDING" },
      });


      await sendEmail({
        email: req.user?.email as string,
        subject: "Visa request payment confirmation",
        html: `<p>Dear ${req.user?.fullName as string},</p>
            <p>You are required to pay the statutory $200 USD fee directly to GIS at Kotoka International Airport upon arrival.</p>
            <p>Thank you for choosing our tour!</p>`,
      });
    }

    const log = await prisma.hubtelDirectReceiveLog.create({
      data: {
        message: Data.Description,
        responseCode: Data.responseCode,
        amount: Data.Amount,
        charges: 0,
        amountAfterCharges: 0,
        amountCharged: Data.Amount,
        description: Data.Description,
        clientReference: Data.ClientReference,
        transactionId: Data.SalesInvoiceId,
        deliveryFee: 0,
        paymentDetails: Data.paymentDetails
      },
    });
  }else {
    // upate visa request,
    // update payment, 
    // update hubtel data
    await prisma.visaOnArrivalRequest.update({
          where: { paymentId: payment.id },
          data: { status: VisaRequestStatus.PAYMENT_FAILED },
        });
    
    await prisma.payment.update({
      where: {id: payment.id},
      data: {status: PaymentStatus.FAILED}
    })

 const log = await prisma.hubtelDirectReceiveLog.create({
      data: {
        message: Data.Description,
        responseCode: Data.responseCode,
        amount: Data.Amount,
        charges: 0,
        amountAfterCharges: 0,
        amountCharged: Data.Amount,
        description: Data.Description,
        clientReference: Data.ClientReference,
        transactionId: Data.SalesInvoiceId,
        deliveryFee: 0,
        paymentDetails: Data.paymentDetails
      },
    });
    
    
  }

  res.json({ success: true });
  }catch(e){
    console.log("visa callback failed ",e)
    return res.status(500).json({
      success: false,
      message: "Failed to handle callback",
      error: e instanceof Error ? e.message: "Unknown error occured"
    })
  }
}


static async getAccountId(accountName: string): Promise<string> {
  const account = await prisma.ledgerAccount.findUnique({
    where: { name: accountName },
  });

  if (!account) {
    throw new Error(`Ledger account not found: ${accountName}`);
  }

  return account.id;
}


async getVisaRequest(req: Request, res:Response){
  try{
    const user = req.user?.id as string;
    const visaRequest = await prisma.visaOnArrivalRequest.findMany({
      where: {userId: user}
    })
    return res.status(200).json({
      success:true,
      data: visaRequest,
    });
  }catch(error){
    console.error("Failed to get visa requests ", error);
    return res.status(500).json({
      success:false,
      message: "Failed to get visa request",
      error: error instanceof Error ? error.message: "Unkown error occured"
    })
  }
}

async getVisaStatus(req: Request, res: Response){
  try{
    const userId = req.user?.id as string;
    const {requestId:visaRequestId } = req.params;
    if (!visaRequestId) return res.status(400).json({success:false, message: "visaRequest id required"})
    const visaRequest = await prisma.visaOnArrivalRequest.findUnique({
      where: { userId, id: visaRequestId as string},
      select: { status: true},
    });
    return res.status(200).json({success:true, message: "success", data: visaRequest})
  }catch(e){
    console.log("Failed to get visa status ", e)
    return res.status(500).json({
      success: false, 
      message: "Failed to get visa status ", 
      error: e instanceof Error ? e.message: "Unkown error occured" })
  }
}


}