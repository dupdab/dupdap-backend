import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Group } from './entities/group.entity';
import { GroupMember, GroupMemberRole } from './entities/group-member.entity';

@Injectable()
export class GroupsRepository extends Repository<Group> {
  constructor(private dataSource: DataSource) {
    super(Group, dataSource.createEntityManager());
  }

  async findByIdWithMembers(id: string): Promise<Group | null> {
    return this.createQueryBuilder('g')
      .leftJoinAndSelect('g.members', 'm')
      .where('g.id = :id', { id })
      .andWhere('g.deletedAt IS NULL')
      .getOne();
  }

  async findByInviteCode(inviteCode: string): Promise<Group | null> {
    return this.createQueryBuilder('g')
      .leftJoinAndSelect('g.members', 'm')
      .where('g.inviteCode = :inviteCode', { inviteCode })
      .andWhere('g.deletedAt IS NULL')
      .getOne();
  }

  /**
   * Search groups by name. Results are limited to public groups plus any
   * private groups the requester already belongs to, so that `isPublic: false`
   * groups (and their invite codes) are never discoverable by outsiders.
   */
  async search(
    name: string | undefined,
    page: number,
    limit: number,
    requesterId: string,
  ): Promise<[Group[], number]> {
    const qb = this.createQueryBuilder('g')
      .leftJoin('g.members', 'm')
      .addSelect('COUNT(m.id)', 'memberCount')
      .where('g.deletedAt IS NULL')
      .andWhere(
        (sub) => {
          const memberGroups = sub
            .subQuery()
            .select('gm.groupId')
            .from(GroupMember, 'gm')
            .where('gm.userId = :requesterId')
            .getQuery();
          return `(g.isPublic = true OR g.id IN ${memberGroups})`;
        },
      )
      .setParameter('requesterId', requesterId)
      .groupBy('g.id')
      .orderBy('g.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (name) {
      qb.andWhere('g.name ILIKE :name', { name: `%${name}%` });
    }

    const [groups, total] = await qb.getManyAndCount();
    return [groups, total];
  }

  async countMembers(groupId: string): Promise<number> {
    return this.dataSource
      .getRepository(GroupMember)
      .count({ where: { groupId } });
  }

  async isMember(groupId: string, userId: string): Promise<boolean> {
    const count = await this.dataSource
      .getRepository(GroupMember)
      .count({ where: { groupId, userId } });
    return count > 0;
  }

  async addMember(
    groupId: string,
    userId: string,
    role: GroupMemberRole = GroupMemberRole.MEMBER,
  ): Promise<GroupMember> {
    const member = this.dataSource.getRepository(GroupMember).create({
      groupId,
      userId,
      role,
    });
    return this.dataSource.getRepository(GroupMember).save(member);
  }

  async softDeleteGroup(id: string): Promise<void> {
    await this.softDelete(id);
  }
}
