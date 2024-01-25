import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { AppContext, RDSEngine, StackCommonProps, StackConfig } from '../config';
import { Credentials } from 'aws-cdk-lib/aws-rds';

export class WebhookECS extends cdk.Stack {
  vpc: ec2.Vpc;
  logGroups: logs.LogGroup[];
  rds: rds.DatabaseInstance;
  elasticCache: elasticache.CfnCacheCluster;
  ecrList: ecr.Repository[];
  ecs: ecs.Cluster;

  constructor(appContext: AppContext, stackConfig: StackConfig) {

    super(appContext.cdkApp, stackConfig.webhookECS.name, {
      stackName: stackConfig.webhookECS.name,
      description: stackConfig.webhookECS.description
    });

    // Create VPC
    this.createVPC(stackConfig);

    // Create ElasticCache
    this.createElasticCache(this.vpc, stackConfig);

    // Create Cloudwatch group
    this.createCloudWatchGroup(stackConfig);

    // Create ECR Repositories
    this.createECRRepositories(stackConfig);

    // Create RDS
    this.createRDS(this.vpc, stackConfig);

    // Create ECS Cluster
    this.createECS(this.vpc, stackConfig);
  }

  createVPC(stackConfig: StackConfig) {
    const vpc = stackConfig.webhookECS.vpc;
    this.vpc = new ec2.Vpc(this, vpc.name, {
      cidr: vpc.cidr,
      maxAzs: vpc.maxAZs,
      subnetConfiguration: vpc.subnetConfiguration,
    });

    // Create VPC Endpoint for Parameter Store can connect
    this.createVpcEndpoint(this.vpc);

    // Output the URI of the vpc
    new cdk.CfnOutput(this, this.vpc.vpcId, {
      value: this.vpc.vpcArn,
      description: 'URI of the ECR repository',
    });
  }

  createVpcEndpoint(vpc: ec2.Vpc) {
    const parameterStoreEndpoint = new ec2.InterfaceVpcEndpoint(this, 'ParameterStoreEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      vpc,
    });

    // Create an IAM role for the VPC endpoint
    const vpcEndpointRole = new iam.Role(this, 'ParameterStoreEndpointRole', {
      assumedBy: new iam.ServicePrincipal('vpc-endpoint.amazonaws.com'),
    });

    // Attach the inline policy to the IAM role
    vpcEndpointRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:PutParameter', 'ssm:GetParameter'],
        resources: ['*'],
        effect: iam.Effect.ALLOW,
      })
    );

    // Associate the IAM role with the VPC endpoint
    parameterStoreEndpoint.addToPolicy(
      new iam.PolicyStatement({
        actions: ['*'],
        resources: ['*'],
        effect: iam.Effect.ALLOW,
        principals: [new iam.ArnPrincipal(vpcEndpointRole.roleArn)],
      })
    );
  }

  createECS(vpc: ec2.Vpc, stackConfig: StackConfig) {
    const cluster = new ecs.Cluster(this, stackConfig.ECSClusterName, { vpc });
    cluster.addCapacity('DefaultAutoScalingGroup', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO)
    });

    // create a task definition with CloudWatch Logs
    const logging = new ecs.AwsLogDriver({ streamPrefix: "ecs" })

    const taskDef = new ecs.Ec2TaskDefinition(this, "MyTaskDefinition");
    taskDef.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memoryLimitMiB: 512,
      logging,
    })

    // Instantiate ECS Service with just cluster and image
    new ecs.Ec2Service(this, "Ec2Service", {
      cluster,
      taskDefinition: taskDef,
    });
  }

  createECRRepositories(stackConfig: StackConfig) {
    const listRepositoriesName = stackConfig.webhookECS.ecr.repositoriesName || [];
    for (const repoName of listRepositoriesName) {
      // Create ECR repository
      const ecrRepository = new ecr.Repository(this, repoName, {
        repositoryName: repoName, // Specify the name of the ECR repository
      });
      this.ecrList.push(ecrRepository);

      // Output the URI of the ECR repository
      new cdk.CfnOutput(this, repoName, {
        value: ecrRepository.repositoryUri,
        description: 'URI of the ECR repository',
      });
    }
  }

  createElasticCache(vpc: ec2.Vpc, stackConfig: StackConfig) {
    const elasticCacheConfig = stackConfig.webhookECS.elasticCache;
    // Create ElastiCache Redis cluster
    this.elasticCache = new elasticache.CfnCacheCluster(this, elasticCacheConfig.name, {
      engine: elasticCacheConfig.engine,
      cacheNodeType: elasticCacheConfig.cacheNodeType, // Adjust based on your needs
      numCacheNodes: elasticCacheConfig.numCacheNodes, // Adjust based on your needs
      vpcSecurityGroupIds: [], // Security groups will be added dynamically
      cacheSubnetGroupName: new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
        description: 'Subnet group for Redis',
        subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
      }).ref,
    });

    // Allow instances in the VPC to connect to the Redis cluster
    const securityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
    });
    securityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(6379));

    // Update the ElastiCache Redis cluster with the security group
    this.elasticCache.vpcSecurityGroupIds = [securityGroup.securityGroupId];

    // Save Redis endpoint to Parameter Store
    const redisSSM = stackConfig.webhookECS.ssmParameter.redis.host.name;
    new ssm.StringParameter(this, redisSSM, {
      parameterName: redisSSM,
      stringValue: this.elasticCache.attrRedisEndpointAddress,
    });

    // Output the endpoint of the Redis cluster
    new cdk.CfnOutput(this, 'RedisClusterEndpoint', {
      value: this.elasticCache.attrRedisEndpointAddress,
      description: 'Endpoint of the ElastiCache Redis cluster',
    });
  }

  createRDS(vpc: ec2.Vpc, stackConfig: StackConfig) {
    const rdsConfig = stackConfig.webhookECS.rds;
    // Create RDS instance in the existing VPC
    this.rds = new rds.DatabaseInstance(this, rdsConfig.name, {
      engine: RDSEngine[rdsConfig.engine], // Use PostgreSQL as the database engine
      credentials: Credentials.fromPassword(stackConfig.rds.username, stackConfig.rds.password),
      vpc: vpc, // Use the existing VPC
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }, // Specify the subnets where the RDS instance should be launched
      allocatedStorage: rdsConfig.allocatedStorage, // Specify the allocated storage in GB
    });

    // Save rds endpoint to Parameter Store
    const rdsSSM = stackConfig.webhookECS.ssmParameter.rds.host.name;
    new ssm.StringParameter(this, rdsSSM, {
      parameterName: rdsSSM,
      stringValue: this.rds.instanceEndpoint.socketAddress,
    });

    // Output the connection details of the RDS instance
    new cdk.CfnOutput(this, 'RDSConnectionDetails', {
      value: this.rds.dbInstanceEndpointAddress,
      description: 'Connection details of the RDS instance',
    });
  }

  createCloudWatchGroup(stackConfig: StackConfig) {
    const logGroupNames = stackConfig.webhookECS.logs.logGroupNames || [];
    for (const logGroupName of logGroupNames) {
      const log = new logs.LogGroup(this, logGroupName, {
        logGroupName: logGroupName, // Specify the name of the log group
        retention: stackConfig.webhookECS.logs.retention, // Specify the retention period in days
      });

      this.logGroups.push(log);

       // Output the log group
      new cdk.CfnOutput(this, logGroupName, {
        value: log.logGroupName,
        description: `Log group ${logGroupName} created.`,
      });
    }
  }
}