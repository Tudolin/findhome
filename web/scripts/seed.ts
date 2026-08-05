/**
 * FindHome seed script.
 *
 * Run it with:  docker compose run --rm migrate npm run db:seed
 *
 * Lives inside the web package (not next to schema.prisma) so Node resolves
 * @prisma/client and bcryptjs from web/node_modules.
 * Creates two demo users, a shared Party, preference profiles and a set of
 * DEMO properties so the UI is usable before the first scraper run.
 *
 * Safe to re-run: everything is upserted.
 */
import { PrismaClient, PartyRole, InteractionStatus, PropertySource } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'findhome123';

const DEMO_PROPERTIES = [
  {
    externalId: 'demo-001',
    title: 'Apartamento reformado com varanda em Pinheiros',
    address: 'Rua dos Pinheiros, 1200',
    neighborhood: 'Pinheiros',
    city: 'São Paulo',
    state: 'SP',
    rentPrice: 3200,
    condoFee: 780,
    taxFee: 120,
    bedrooms: 2,
    bathrooms: 2,
    parkingSpots: 1,
    sqm: 68,
    petFriendly: true,
    amenities: ['Elevador', 'Portaria 24h', 'Academia'],
    description: 'Dois dormitórios, varanda ampla, 400m do metrô Faria Lima.',
  },
  {
    externalId: 'demo-002',
    title: 'Studio mobiliado na Vila Madalena',
    address: 'Rua Harmonia, 455',
    neighborhood: 'Vila Madalena',
    city: 'São Paulo',
    state: 'SP',
    rentPrice: 2400,
    condoFee: 550,
    taxFee: 90,
    bedrooms: 1,
    bathrooms: 1,
    parkingSpots: 0,
    sqm: 34,
    petFriendly: false,
    amenities: ['Mobiliado', 'Lavanderia'],
    description: 'Studio compacto e mobiliado, ideal para uma pessoa.',
  },
  {
    externalId: 'demo-003',
    title: 'Apartamento 3 quartos com suíte na Pompeia',
    address: 'Rua Clélia, 980',
    neighborhood: 'Pompeia',
    city: 'São Paulo',
    state: 'SP',
    rentPrice: 4100,
    condoFee: 1100,
    taxFee: 210,
    bedrooms: 3,
    bathrooms: 2,
    parkingSpots: 2,
    sqm: 102,
    petFriendly: true,
    amenities: ['Elevador', 'Piscina', 'Churrasqueira', 'Portaria 24h'],
    description: 'Três dormitórios sendo uma suíte, duas vagas cobertas.',
  },
  {
    externalId: 'demo-004',
    title: 'Cobertura duplex em Perdizes',
    address: 'Rua Cardoso de Almeida, 2100',
    neighborhood: 'Perdizes',
    city: 'São Paulo',
    state: 'SP',
    rentPrice: 5600,
    condoFee: 1450,
    taxFee: 380,
    bedrooms: 3,
    bathrooms: 3,
    parkingSpots: 2,
    sqm: 145,
    petFriendly: true,
    amenities: ['Terraço', 'Churrasqueira', 'Elevador'],
    description: 'Duplex com terraço privativo e vista livre.',
  },
  {
    externalId: 'demo-005',
    title: 'Apartamento 2 quartos próximo ao metrô Sumaré',
    address: 'Av. Doutor Arnaldo, 640',
    neighborhood: 'Sumaré',
    city: 'São Paulo',
    state: 'SP',
    rentPrice: 2900,
    condoFee: 620,
    taxFee: 140,
    bedrooms: 2,
    bathrooms: 1,
    parkingSpots: 1,
    sqm: 61,
    petFriendly: true,
    amenities: ['Elevador', 'Portaria 24h'],
    description: 'Dois dormitórios, prédio com portaria, 300m do metrô.',
  },
  {
    externalId: 'demo-006',
    title: 'Apartamento amplo na Barra Funda',
    address: 'Rua Vitorino Carmilo, 320',
    neighborhood: 'Barra Funda',
    city: 'São Paulo',
    state: 'SP',
    rentPrice: 2100,
    condoFee: 480,
    taxFee: 80,
    bedrooms: 2,
    bathrooms: 1,
    parkingSpots: 1,
    sqm: 72,
    petFriendly: false,
    amenities: ['Portaria 24h'],
    description: 'Planta ampla, prédio antigo bem conservado.',
  },
];

async function main() {
  const passwordHash = await hash(DEMO_PASSWORD, 10);

  const alex = await prisma.user.upsert({
    where: { email: 'alex@findhome.local' },
    update: {},
    create: { email: 'alex@findhome.local', name: 'Alex', passwordHash },
  });

  const sam = await prisma.user.upsert({
    where: { email: 'sam@findhome.local' },
    update: {},
    create: { email: 'sam@findhome.local', name: 'Sam', passwordHash },
  });

  const party = await prisma.party.upsert({
    where: { inviteCode: 'DEMO2026' },
    update: {},
    create: {
      name: 'Alex & Sam — Mudança 2026',
      inviteCode: 'DEMO2026',
      createdByUserId: alex.id,
      members: {
        create: [
          { userId: alex.id, role: PartyRole.OWNER },
          { userId: sam.id, role: PartyRole.MEMBER },
        ],
      },
    },
  });

  await prisma.preferenceProfile.upsert({
    where: { userId: alex.id },
    update: {},
    create: {
      userId: alex.id,
      city: 'São Paulo',
      // Deliberately looser than the party profile below, so the two
      // workspaces visibly return different feeds on first login.
      neighborhoods: ['Pinheiros', 'Vila Madalena', 'Sumaré', 'Barra Funda'],
      minPrice: 1500,
      maxPrice: 4500,
      includeCondoInMaxPrice: true,
      minBedrooms: 1,
      minBathrooms: 1,
      minParkingSpots: 0,
      minSqm: 30,
      petFriendly: false,
      amenities: [],
    },
  });

  await prisma.preferenceProfile.upsert({
    where: { partyId: party.id },
    update: {},
    create: {
      partyId: party.id,
      city: 'São Paulo',
      neighborhoods: ['Pinheiros', 'Pompeia', 'Perdizes', 'Sumaré'],
      minPrice: 2000,
      maxPrice: 5500,
      includeCondoInMaxPrice: true,
      minBedrooms: 2,
      minBathrooms: 1,
      minParkingSpots: 1,
      minSqm: 55,
      petFriendly: true,
      amenities: ['Elevador', 'Portaria 24h'],
    },
  });

  const properties = [];
  for (const p of DEMO_PROPERTIES) {
    const totalPrice = p.rentPrice + p.condoFee + p.taxFee;
    const sourceUrl = `https://demo.findhome.local/imovel/${p.externalId}`;
    const property = await prisma.property.upsert({
      where: { source_externalId: { source: PropertySource.DEMO, externalId: p.externalId } },
      update: { lastSeenAt: new Date() },
      create: {
        ...p,
        source: PropertySource.DEMO,
        sourceUrl,
        totalPrice,
        images: [
          `https://picsum.photos/seed/${p.externalId}-a/800/600`,
          `https://picsum.photos/seed/${p.externalId}-b/800/600`,
          `https://picsum.photos/seed/${p.externalId}-c/800/600`,
        ],
      },
    });
    properties.push(property);
  }

  // A few party interactions so the Co-Op board is not empty on first login.
  const board: Array<[number, string, InteractionStatus, number, string[], string[]]> = [
    [0, alex.id, InteractionStatus.FAVORITE, 5, ['Perto do metrô', 'Varanda ampla'], ['Condomínio caro']],
    [0, sam.id, InteractionStatus.FAVORITE, 4, ['Reformado'], ['Só uma vaga']],
    [2, alex.id, InteractionStatus.VISIT_SCHEDULED, 4, ['Três quartos', 'Duas vagas'], ['Longe do trabalho']],
    [2, sam.id, InteractionStatus.VISIT_SCHEDULED, 5, ['Suíte', 'Piscina'], []],
    [3, alex.id, InteractionStatus.INTERESTED, 3, ['Terraço'], ['Acima do orçamento']],
    [4, sam.id, InteractionStatus.INTERESTED, 4, ['Bom preço'], ['Sem elevador social']],
    [5, alex.id, InteractionStatus.REJECTED, 2, [], ['Não aceita pet', 'Prédio antigo']],
  ];

  for (const [idx, userId, status, rating, pros, cons] of board) {
    const propertyId = properties[idx].id;
    await prisma.propertyInteraction.upsert({
      where: {
        propertyId_userId_scopeKey: { propertyId, userId, scopeKey: party.id },
      },
      update: { status, rating, pros, cons },
      create: { propertyId, userId, partyId: party.id, scopeKey: party.id, status, rating, pros, cons },
    });
  }

  await prisma.propertyComment.createMany({
    data: [
      {
        propertyId: properties[0].id,
        userId: alex.id,
        partyId: party.id,
        scopeKey: party.id,
        body: 'Visitei o prédio por fora, a rua é bem tranquila. Vale agendar.',
      },
      {
        propertyId: properties[0].id,
        userId: sam.id,
        partyId: party.id,
        scopeKey: party.id,
        body: 'Concordo. Só fiquei preocupado com o condomínio de R$ 780.',
      },
    ],
    skipDuplicates: true,
  });

  console.log('Seed complete.');
  console.log(`  users:      alex@findhome.local / sam@findhome.local  (password: ${DEMO_PASSWORD})`);
  console.log(`  party:      ${party.name}  (invite code: ${party.inviteCode})`);
  console.log(`  properties: ${properties.length} DEMO listings`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
