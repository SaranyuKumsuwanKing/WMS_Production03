-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'OPERATOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bin" (
    "id" SERIAL NOT NULL,
    "warehouseId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'STORAGE',
    "barcode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" SERIAL NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "category" TEXT,
    "inventoryType" TEXT,
    "minStock" DECIMAL(65,30),
    "lotControlled" BOOLEAN NOT NULL DEFAULT true,
    "barcode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "lotCode" TEXT NOT NULL,
    "receivedDate" TIMESTAMP(3),
    "supplier" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "id" SERIAL NOT NULL,
    "itemId" INTEGER NOT NULL,
    "binId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "firstReceivedAt" TIMESTAMP(3),
    "lastReceivedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "userId" INTEGER NOT NULL,
    "clientRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovementLine" (
    "id" SERIAL NOT NULL,
    "movementId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "binId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "qtyDelta" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "StockMovementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountSession" (
    "id" SERIAL NOT NULL,
    "warehouseId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" INTEGER,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "CountSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountLine" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,
    "binId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "systemQty" DECIMAL(65,30) NOT NULL,
    "countedQty" DECIMAL(65,30),
    "variance" DECIMAL(65,30),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "countedById" INTEGER,
    "countedAt" TIMESTAMP(3),

    CONSTRAINT "CountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Bin_barcode_key" ON "Bin"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Bin_warehouseId_code_key" ON "Bin"("warehouseId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Item_itemNumber_key" ON "Item"("itemNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Item_barcode_key" ON "Item"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_itemId_lotCode_key" ON "Lot"("itemId", "lotCode");

-- CreateIndex
CREATE INDEX "StockLevel_binId_idx" ON "StockLevel"("binId");

-- CreateIndex
CREATE INDEX "StockLevel_itemId_idx" ON "StockLevel"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLevel_itemId_binId_lotId_key" ON "StockLevel"("itemId", "binId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_clientRequestId_key" ON "StockMovement"("clientRequestId");

-- CreateIndex
CREATE INDEX "StockMovement_type_idx" ON "StockMovement"("type");

-- CreateIndex
CREATE INDEX "StockMovement_createdAt_idx" ON "StockMovement"("createdAt");

-- CreateIndex
CREATE INDEX "StockMovementLine_movementId_idx" ON "StockMovementLine"("movementId");

-- CreateIndex
CREATE INDEX "StockMovementLine_itemId_idx" ON "StockMovementLine"("itemId");

-- CreateIndex
CREATE INDEX "StockMovementLine_binId_idx" ON "StockMovementLine"("binId");

-- CreateIndex
CREATE UNIQUE INDEX "CountLine_sessionId_itemId_binId_lotId_key" ON "CountLine"("sessionId", "itemId", "binId", "lotId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_idx" ON "AuditLog"("entity");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Bin" ADD CONSTRAINT "Bin_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovementLine" ADD CONSTRAINT "StockMovementLine_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "StockMovement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovementLine" ADD CONSTRAINT "StockMovementLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovementLine" ADD CONSTRAINT "StockMovementLine_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovementLine" ADD CONSTRAINT "StockMovementLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountSession" ADD CONSTRAINT "CountSession_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountSession" ADD CONSTRAINT "CountSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountSession" ADD CONSTRAINT "CountSession_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountLine" ADD CONSTRAINT "CountLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountLine" ADD CONSTRAINT "CountLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountLine" ADD CONSTRAINT "CountLine_binId_fkey" FOREIGN KEY ("binId") REFERENCES "Bin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountLine" ADD CONSTRAINT "CountLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountLine" ADD CONSTRAINT "CountLine_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
