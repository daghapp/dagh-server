import { Server, Socket } from 'socket.io'
import { prisma } from '../lib/prisma'
import jwt from 'jsonwebtoken'

interface AuthenticatedSocket extends Socket {
  userId?: string
}

export const setupSocketHandlers = (io: Server) => {
  // Authentication middleware for Socket.IO
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token
      if (!token) {
        return next(new Error('Authentication required'))
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
      const user = await prisma.user.findUnique({
        where: { id: decoded.id }
      })

      if (!user) {
        return next(new Error('User not found'))
      }

      socket.userId = user.id
      next()
    } catch (error) {
      next(new Error('Invalid token'))
    }
  })

  io.on('connection', (socket: AuthenticatedSocket) => {
    console.log(`User ${socket.userId} connected`)

    // Join user to their private room
    if (socket.userId) {
      socket.join(`user:${socket.userId}`)
    }

    // Handle typing events
    socket.on('typing', ({ receiverId, isTyping }) => {
      socket.to(`user:${receiverId}`).emit('user_typing', {
        userId: socket.userId,
        isTyping
      })
    })

    // Handle message read receipts
    socket.on('mark_read', async ({ messageId, senderId }) => {
      await prisma.message.update({
        where: { id: messageId },
        data: { isRead: true, readAt: new Date() }
      })
      
      socket.to(`user:${senderId}`).emit('message_read', { messageId })
    })

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`User ${socket.userId} disconnected`)
    })
  })

  return io
}