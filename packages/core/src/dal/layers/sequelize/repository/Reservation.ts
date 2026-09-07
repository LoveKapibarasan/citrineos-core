// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import { CrudRepository } from '@citrineos/base';
import { OCPP2_0_1 } from '@citrineos/types';
import type { IReservationRepository } from '../../../interfaces/repositories.js';
import { SequelizeRepository, type SequelizeRepositoryDependencies } from './Base.js';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { EvseType } from '../model/DeviceModel/EvseType.js';
import { Reservation } from '../model/Reservation.js';

export class SequelizeReservationRepository
  extends SequelizeRepository<Reservation>
  implements IReservationRepository
{
  evse: CrudRepository<EvseType>;
  logger: Logger<ILogObj>;

  constructor({ config, logger, sequelizeInstance }: SequelizeRepositoryDependencies) {
    super({ config, namespace: Reservation.MODEL_NAME, logger, sequelizeInstance });
    this.evse = new SequelizeRepository<EvseType>({
      config,
      namespace: EvseType.MODEL_NAME,
      logger,
      sequelizeInstance,
    });
    this.logger = logger
      ? logger.getSubLogger({ name: this.constructor.name })
      : new Logger<ILogObj>({ name: this.constructor.name });
  }

  async createOrUpdateReservation(
    tenantId: number,
    reserveNowRequest: OCPP2_0_1.ReserveNowRequest,
    ocppConnectionName: string,
    isActive?: boolean,
  ): Promise<Reservation | undefined> {
    let evseDBId: number | null = null;
    if (reserveNowRequest.evseId) {
      /**
       * Find *or create* the EvseType row.
       *
       * Reading alone made every ReserveNow that named an evseId fail on a
       * bench where `EvseTypes` is empty. The station's EVSEs are in `Evses`
       * -- written when the charger reports itself -- while nothing on that
       * path writes an `EvseTypes` row, so the lookup could not succeed and
       * the reservation was refused before it ever reached the charger:
       *
       *   ReserveNow -> "Reservation could not be stored for station: cp001."
       *   SequelizeReservationRepository  Could not find evse with id 1
       *
       * An EvseType is the OCPP 2.0.1 EVSE *number*, not a piece of hardware
       * -- `id` is the serial the charger uses and the unique index is
       * (tenantId, id) where connectorId is null. So creating the row for a
       * number the charger has just named is recording what it told us,
       * which is what every other device-model row here does. Station
       * scoping comes from the reservation's own ocppConnectionName.
       *
       * ai-charge/citrineos-payment#399
       */
      const [evse] = await this.evse.readOrCreateByQuery(tenantId, {
        where: {
          id: reserveNowRequest.evseId,
          connectorId: null,
        },
        defaults: {
          id: reserveNowRequest.evseId,
          connectorId: null,
        },
      });
      if (!evse) {
        this.logger.error(`Could not find evse with id ${reserveNowRequest.evseId}`);
        return undefined;
      } else {
        evseDBId = evse.databaseId;
      }
    }

    const [storedReservation, created] = await this.readOrCreateByQuery(tenantId, {
      where: {
        tenantId,
        // unique constraints
        ocppConnectionName: ocppConnectionName,
        id: reserveNowRequest.id,
      },
      defaults: {
        expiryDateTime: reserveNowRequest.expiryDateTime,
        connectorType: reserveNowRequest.connectorType,
        evseId: evseDBId,
        idToken: reserveNowRequest.idToken,
        groupIdToken: reserveNowRequest.groupIdToken ? reserveNowRequest.groupIdToken : null,
      },
    });

    if (!created) {
      return await this.updateByKey(
        tenantId,
        {
          expiryDateTime: reserveNowRequest.expiryDateTime,
          connectorType: reserveNowRequest.connectorType ?? null,
          evseId: evseDBId,
          idToken: reserveNowRequest.idToken,
          groupIdToken: reserveNowRequest.groupIdToken ?? null,
          isActive,
        },
        storedReservation.databaseId.toString(),
      );
    } else {
      return storedReservation;
    }
  }

  async getNextReservationId(tenantId: number, ocppConnectionName: string): Promise<number> {
    return await this.readNextValue(tenantId, 'id', {
      where: { ocppConnectionName: ocppConnectionName },
    });
  }
}

export default SequelizeReservationRepository;
