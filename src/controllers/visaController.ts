import { Request, Response } from 'express'
import { prisma } from '../lib/prisma'

export const createVisaApplication = async (req: Request, res: Response) => {
  try {
    const {
      passportNumber,
      nationality,
      firstName,
      lastName,
      dateOfBirth,
      passportExpiry,
      purposeOfVisit,
      arrivalDate,
      placeOfLodging,
      contact
    } = req.body

    const userId = req.user?.id

    // Additional business logic validation
    const today = new Date()
    const birthDate = new Date(dateOfBirth)
    const expiryDate = new Date(passportExpiry)
    const arrival = new Date(arrivalDate)

    // Check if user is at least 18 years old
    const age = today.getFullYear() - birthDate.getFullYear()
    if (age < 18) {
      return res.status(400).json({
        success: false,
        error: 'Applicant must be at least 18 years old'
      })
    }

    // Check if passport is not expired
    if (expiryDate < today) {
      return res.status(400).json({
        success: false,
        error: 'Passport has expired'
      })
    }

    // Check if arrival date is in the future
    if (arrival < today) {
      return res.status(400).json({
        success: false,
        error: 'Arrival date must be in the future'
      })
    }

    const result = await prisma.$transaction(async (tx) => {
      // Check for existing pending application with same passport
      const existingPassport = await tx.passport.findUnique({
        where: { passportNumber }
      })

      if (existingPassport) {
        const existingApplication = await tx.visaApplication.findFirst({
          where: {
            passportId: existingPassport.id,
            status: { in: ['PENDING', 'REVIEW'] }
          }
        })

        if (existingApplication) {
          throw new Error('You already have a pending visa application')
        }
      }

      // Create or find passport
      const passport = await tx.passport.upsert({
        where: { passportNumber },
        update: {
          firstName,
          lastName,
          nationality,
          dateOfBirth: new Date(dateOfBirth),
          expiryDate: new Date(passportExpiry)
        },
        create: {
          passportNumber,
          firstName,
          lastName,
          nationality,
          dateOfBirth: new Date(dateOfBirth),
          expiryDate: new Date(passportExpiry)
        }
      })

      // Create purpose
      const purpose = await tx.purpose.create({
        data: { type: purposeOfVisit }
      })

      // Create lodging
      const lodging = await tx.lodging.create({
        data: {
          type: placeOfLodging.type,
          name: placeOfLodging.name,
          address: placeOfLodging.address
        }
      })

      // Create visa application
      const application = await tx.visaApplication.create({
        data: {
          userId,
          passportId: passport.id,
          purposeId: purpose.id,
          lodgingId: lodging.id,
          arrivalDate: arrival,
          status: 'PENDING',
          paymentStatus: 'PENDING'
        },
        include: {
          passport: true,
          purpose: true,
          lodging: true
        }
      })

      return application
    })

    res.status(201).json({
      success: true,
      data: result
    })
  } catch (error) {
    console.error('Create application error:', error)
    
    if (error instanceof Error) {
      return res.status(400).json({
        success: false,
        error: error.message
      })
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create visa application'
    })
  }
}



export const getUserApplications = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id
    
    const applications = await prisma.visaApplication.findMany({
      where: { userId },
      include: {
        passport: true,
        purpose: true,
        lodging: true,
        documents: true
      },
      orderBy: { createdAt: 'desc' }
    })

    res.json({
      success: true,
      data: applications
    })
  } catch (error) {
    console.error('Get user applications error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch applications'
    })
  }
}

export const getApplicationById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const userId = req.user?.id
    const userRole = req.user?.role

    const application = await prisma.visaApplication.findFirst({
      where: {
        id,
        ...(userRole !== 'ADMIN' ? { userId } : {})
      },
      include: {
        passport: true,
        purpose: true,
        lodging: true,
        documents: true,
        user: {
          select: { email: true, phone: true }
        }
      }
    })

    if (!application) {
      return res.status(404).json({
        success: false,
        error: 'Application not found'
      })
    }

    res.json({
      success: true,
      data: application
    })
  } catch (error) {
    console.error('Get application error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch application'
    })
  }
}

export const uploadDocument = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { documentType, fileUrl } = req.body

    const application = await prisma.visaApplication.findFirst({
      where: {
        id,
        userId: req.user?.id
      }
    })

    if (!application) {
      return res.status(404).json({
        success: false,
        error: 'Application not found'
      })
    }

    const document = await prisma.visaDocument.create({
      data: {
        applicationId: id,
        type: documentType,
        fileUrl
      }
    })

    if (application.status === 'PENDING') {
      await prisma.visaApplication.update({
        where: { id },
        data: { status: 'REVIEW' }
      })
    }

    res.json({
      success: true,
      data: document
    })
  } catch (error) {
    console.error('Upload document error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to upload document'
    })
  }
}

export const scanPassport = async (req: Request, res: Response) => {
  try {
    const { imageUrl, passportNumber, firstName, lastName, nationality, dateOfBirth, expiryDate } = req.body
    
    const passport = await prisma.passport.create({
      data: {
        passportNumber,
        firstName,
        lastName,
        nationality,
        dateOfBirth: new Date(dateOfBirth),
        expiryDate: new Date(expiryDate),
        imageUrl
      }
    })

    res.json({
      success: true,
      data: passport
    })
  } catch (error) {
    console.error('Scan passport error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to scan passport'
    })
  }
}

export const getAllApplications = async (req: Request, res: Response) => {
  try {
    const { status, page = 1, limit = 10 } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const where = status ? { status: status as string } : {}

    const [applications, total] = await Promise.all([
      prisma.visaApplication.findMany({
        where,
        include: {
          passport: true,
          purpose: true,
          lodging: true,
          user: {
            select: { email: true, phone: true }
          }
        },
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.visaApplication.count({ where })
    ])

    res.json({
      success: true,
      data: applications,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    })
  } catch (error) {
    console.error('Get all applications error:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to fetch applications'
    })
  }
}

export const updateVisaStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const action = req.path.includes('approve') ? 'approve' : 'reject'
    const { visaNumber } = req.body

    const status = action === 'approve' ? 'APPROVED' : 'REJECTED'
    
    const updateData: any = { status }
    if (action === 'approve' && visaNumber) {
      updateData.visaNumber = visaNumber
    }

    const application = await prisma.visaApplication.update({
      where: { id },
      data: updateData,
      include: {
        passport: true,
        user: true
      }
    })

    res.json({
      success: true,
      data: application
    })
  } catch (error) {
    console.error('Update status error:', error)
    res.status(500).json({
      success: false,
      error: `Failed to update application status`
    })
  }
}




