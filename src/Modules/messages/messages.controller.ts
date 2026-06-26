import { Request, Response } from 'express'
import { prisma } from '../../config/index.js'
import { Server } from 'socket.io'
import { Conversation } from '../../../generated/prisma/client.js'

let io: Server

export const setIoInstance = (ioInstance: Server) => {
  io = ioInstance
}

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const senderId = req.user!.id
    const { receiverId, content } = req.body

    const message = await prisma.message.create({
      data: { senderId, receiverId, content },
      include: {
        sender: { select: { id: true, email: true } },
        receiver: { select: { id: true, email: true } }
      }
    })

    let conversation = await prisma.conversation.findFirst({
      where: {
        AND: [
          { participants: { has: senderId } },
          { participants: { has: receiverId } }
        ]
      }
    })

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          participants: [senderId, receiverId],
          lastMessage: content,
          lastMessageAt: new Date()
        }
      })
    } else {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessage: content, lastMessageAt: new Date() }
      })
    }

    if (io) {
      io.to(`user:${receiverId}`).emit('new_message', message)
      io.to(`user:${senderId}`).emit('message_sent', message)
    }

    res.status(201).json({ success: true, data: message })
  } catch (error) {
    console.error('Send message error:', error)
    res.status(500).json({ success: false, error: 'Failed to send message' })
  }
}

export const getConversations = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id

    const conversations = await prisma.conversation.findMany({
      where: { participants: { has: userId } },
      orderBy: { lastMessageAt: 'desc' }
    })

    const conversationsWithDetails = await Promise.all(
      conversations.map(async (conv: Conversation) => {
        const otherParticipantId = conv.participants.find((p: string) => p !== userId) ?? ''
        const otherUser = await prisma.user.findUnique({
          where: { id: otherParticipantId },
          select: { id: true, email: true }
        })
        const profile = await prisma.userProfile.findUnique({
          where: { userId: otherParticipantId },
          select: { profileUrl: true}
        })

        return { ...conv, otherUser, profile }
      })
    )

    res.json({ success: true, data: conversationsWithDetails })
  } catch (error) {
    console.error('Get conversations error:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch conversations' })
  }
}

export const getMessages = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const conversationId = req.params.conversationId as string

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, participants: { has: userId } }
    })

    if (!conversation) {
      return res.status(404).json({ success: false, error: 'Conversation not found' })
    }

    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: { in: conversation.participants } },
          { receiverId: userId, senderId: { in: conversation.participants } }
        ]
      },
      orderBy: { createdAt: 'asc' },
      include: {
        sender: { select: { id: true, email: true } },
        receiver: { select: { id: true, email: true } }
      }
    })

    await prisma.message.updateMany({
      where: { receiverId: userId, isRead: false },
      data: { isRead: true, readAt: new Date() }
    })

    res.json({ success: true, data: messages })
  } catch (error) {
    console.error('Get messages error:', error)
    res.status(500).json({ success: false, error: 'Failed to fetch messages' })
  }
}

export const markAsRead = async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id
    const messageId = req.params.messageId as string

    const message = await prisma.message.update({
      where: { id: messageId, receiverId: userId },
      data: { isRead: true, readAt: new Date() }
    })

    res.json({ success: true, data: message })
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to mark message as read' })
  }
}
