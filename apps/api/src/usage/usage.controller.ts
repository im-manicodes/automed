import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { UsageService } from './usage.service';

/** Uso de IA, costo y pronóstico; precios editables (`Setting` `ia.precios`). */
@Controller('settings')
@UseGuards(SessionGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get('uso')
  summary(@Query('periodo') periodo?: string) {
    return this.usage.summary(periodo);
  }

  @Get('uso/pronostico')
  forecast(@Query('dias') dias?: string) {
    return this.usage.forecast(dias);
  }

  @Get('precios')
  getPrices() {
    return this.usage.getPrices();
  }

  @Put('precios')
  savePrices(@Body() body: unknown) {
    return this.usage.savePrices(body);
  }
}
