const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function seed() {
  console.log('Criando dados iniciais...');
  
  // Cria empresa demo
  const company = await prisma.company.create({
    data: { name: 'AgroDrone Demo', plan: 'pro' }
  });
  
  // Cria usuário admin
  const adminPass = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: {
      email: 'admin@agryon.com',
      password: adminPass,
      name: 'Administrador',
      role: 'admin',
      companyId: company.id
    }
  });
  
  // Cria usuário cliente
  const clientPass = await bcrypt.hash('cliente123', 10);
  await prisma.user.create({
    data: {
      email: 'cliente@demo.com',
      password: clientPass,
      name: 'Cliente Demo',
      role: 'cliente',
      companyId: company.id
    }
  });
  
  // Cria fazendas
  const farm1 = await prisma.farm.create({
    data: { name: 'Fazenda São João', location: 'Ribeirão Preto - SP', companyId: company.id }
  });
  
  const farm2 = await prisma.farm.create({
    data: { name: 'Fazenda Boa Vista', location: 'Sertãozinho - SP', companyId: company.id }
  });
  
  // Cria drones
  await prisma.drone.create({
    data: { code: 'AGRAS001', model: 'DJI Agras T40', companyId: company.id, farmId: farm1.id }
  });
  
  await prisma.drone.create({
    data: { code: 'AGRAS002', model: 'DJI Agras T30', companyId: company.id, farmId: farm2.id }
  });
  
  console.log('Seed completo!');
  console.log('Login admin: admin@agryon.com / admin123');
  console.log('Login cliente: cliente@demo.com / cliente123');
}

seed()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect());
