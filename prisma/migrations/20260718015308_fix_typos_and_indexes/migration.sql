-- CreateIndex
CREATE INDEX "device_tokens_userId_idx" ON "device_tokens"("userId");

-- CreateIndex
CREATE INDEX "tour_requests_userId_idx" ON "tour_requests"("userId");

-- CreateIndex
CREATE INDEX "tour_requests_paymentStatus_idx" ON "tour_requests"("paymentStatus");

-- CreateIndex
CREATE INDEX "visa_on_arrival_requests_userId_idx" ON "visa_on_arrival_requests"("userId");

-- CreateIndex
CREATE INDEX "visa_on_arrival_requests_status_idx" ON "visa_on_arrival_requests"("status");
