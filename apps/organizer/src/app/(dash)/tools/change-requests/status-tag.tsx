import type { ChangeRequestStatus } from '@kgc/shared';
import { STATUS_LABEL } from '@/lib/change-requests-core';
import { Tag } from '../../ui';

const COLOR: Record<ChangeRequestStatus, 'blue' | 'orange' | 'purple' | 'green' | 'grey'> = {
  new: 'blue',
  building: 'orange',
  built: 'purple',
  live: 'green',
  declined: 'grey',
};

export function ChangeStatusTag({ status }: { status: ChangeRequestStatus }) {
  return (
    <Tag color={COLOR[status]} small>
      {STATUS_LABEL[status]}
    </Tag>
  );
}
